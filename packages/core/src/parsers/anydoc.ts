import type { DocumentParser, ParsedDocument } from '../types.js';
import { createRemarkParser } from './remark.js';

/**
 * Non-markdown documents → structured plain text, via `@firecrawl/anydoc`.
 *
 * Strategy: anydoc (a local, no-LLM Rust/napi binding, MIT) converts every
 * supported format through one shared document model into GitHub-Flavored
 * Markdown. That markdown is normalized (see `normalizeAnydocMarkdown`) and fed
 * to the untouched markdown pipeline, so ATX headings populate `heading_path`
 * with no per-format structure logic and there is only ever one parser to
 * reason about.
 *
 * It handles every non-markdown format **except PDF**, which has its own parser
 * (`parsers/pdf.ts`). That is not drift: pdf-inspector exposes page
 * classification, per-page OCR flags, font-encoding warnings and a recoverable
 * document title, and anydoc's wrapper around the same library surfaces none of
 * it — it raises an unsupported error for a scanned PDF instead of reporting
 * *why* the text is missing. Do not collapse the two.
 *
 * ## Two things it is not
 *
 * 1. **Not a cloud call.** Conversion is entirely local — no API key, no
 *    network, no model. anydoc also offers a hosted endpoint; this engine never
 *    calls it, including for the scanned PDFs it cannot read.
 * 2. **Not on by default.** `index.formats` defaults to `['md']`, so an
 *    unconfigured install walks, parses, and indexes exactly what it did
 *    before. Enabling a format is an explicit choice.
 *
 * ## Scope (documented, not silently exceeded)
 *
 * 1. **Never throws on document data.** The indexer isolates per-file failures,
 *    but a parser that throws still costs the file its content and writes a
 *    scary error for something as ordinary as a scanned PDF. anydoc *does*
 *    throw ("unsupported input: …") on a corrupt container and on a mislabeled
 *    file. So a conversion failure degrades to an empty (0-chunk) recorded page
 *    plus a warning naming the file. (The only
 *    throws are the bytes-vs-string wiring guard and the missing-dependency
 *    error, both configuration bugs, not per-file data.)
 * 2. **Spreadsheets are text, not cells.** An `.xlsx` serializes to one line
 *    per row. A large sheet of bare numbers chunks into rows carrying almost no
 *    retrievable meaning, which dilutes the index rather than enriching it —
 *    see `docs/authoring-for-retrieval.md`.
 * 3. **Structure is only as good as the source.** anydoc reads real heading
 *    levels out of the container, so a document using named heading styles
 *    nests correctly. One made of bold body text has no heading information to
 *    find and degrades to correct text with a flatter `heading_path`.
 * 4. **Embedded images are dropped to their alt text.** Indexing image bytes is
 *    out of scope.
 */

/**
 * Config format name → the extensions it claims.
 *
 * Grouped by source application rather than by anydoc's internal format split
 * (which separates `.ppt` from `.pptx`), because this is read by someone
 * deciding "do I have PowerPoint decks in here", not by someone reasoning about
 * container generations.
 */
export const ANYDOC_FORMAT_NAMES = [
  'docx',
  'doc',
  'pptx',
  'xlsx',
  'odt',
  'ods',
  'odp',
  'rtf',
  'epub',
  'csv',
] as const;

export type AnydocFormatName = (typeof ANYDOC_FORMAT_NAMES)[number];

export const ANYDOC_FORMAT_EXTENSIONS: Record<AnydocFormatName, readonly string[]> = {
  docx: ['.docx', '.docm'],
  doc: ['.doc'],
  pptx: ['.ppt', '.pptx', '.pptm', '.pps', '.ppsx', '.ppsm', '.pot'],
  xlsx: ['.xls', '.xlsx', '.xlsm', '.xlsb'],
  odt: ['.odt'],
  ods: ['.ods'],
  odp: ['.odp'],
  rtf: ['.rtf'],
  epub: ['.epub'],
  csv: ['.csv'],
};

export interface AnydocParserOptions {
  /** Which formats to claim. Defaults to none. */
  formats?: AnydocFormatName[];
  /**
   * What to do with a document that fails to convert or yields no text:
   * `'warn'` (default) records an empty page and prints a stderr warning naming
   * the file; `'silent'` records the empty page without the warning. Neither
   * ever throws.
   */
  onFailure?: 'warn' | 'silent';
  /**
   * Hard byte ceiling on a single document. Above it the file is recorded as an
   * empty page rather than handed to the native converter — a memory/CPU bound
   * for callers that read a file directly and so bypass the walker's own
   * `maxFileBytes` skip. Default 20 MiB. `0` disables.
   */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

/** Titles become indexed metadata: keep them one-line and bounded. */
function sanitizeTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function warn(message: string): void {
  process.stderr.write(`[remember] ${message}\n`);
}

/** anydoc's `Format`, narrowed to the string values this parser passes. */
type AnydocFormat =
  | 'doc'
  | 'docx'
  | 'ppt'
  | 'pptx'
  | 'xlsx'
  | 'odt'
  | 'ods'
  | 'odp'
  | 'rtf'
  | 'epub'
  | 'csv';

/** The anydoc exports we depend on, narrowed to what this parser uses. */
type AnydocModule = {
  toMarkdownBytes: (bytes: Uint8Array, format?: AnydocFormat | null) => Promise<string>;
  formatFromExtension: (extension: string) => AnydocFormat | null;
};

/** A GFM delimiter row: `| --- | :--: |`. */
const TABLE_DELIMITER = /^\|(?:\s*:?-{3,}:?\s*\|)+$/;
/** Any table row: starts and ends with a pipe. */
const TABLE_ROW = /^\|.*\|$/;
/**
 * A bullet or ordered list marker, plus any task-list checkbox.
 *
 * Only the two marker families GFM can express. anydoc renders an alpha or
 * roman source list through them, so matching `a)` / `IV.` here would buy
 * nothing and would misread ordinary prose — a table cell reading
 * "I. Introduction" is a sentence, not a list item.
 */
const LIST_MARKER = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
/** An ATX heading, which the chunker matches to build `heading_path`. */
const ATX_HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * Split a GFM table row into its cells.
 *
 * Escaped pipes (`\|`) are cell content, not separators — anydoc escapes them
 * when a cell's own text contains one, so splitting naively shears a cell in half.
 */
function splitRow(line: string): string[] {
  const inner = line.slice(1, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') {
      cur += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/**
 * Neutralize a line that would re-enter the markdown parser as structure.
 *
 * A table cell can legitimately contain text beginning with `#`. Left alone,
 * remark reads the flattened line back as a heading and it lands in
 * `heading_path` as a phantom section. A markdown backslash escape is the right
 * tool: remark consumes it and `mdast-util-to-string` yields the bare `#`, so
 * the indexed text is unchanged and no invisible character enters the corpus.
 */
function neutralize(text: string): string {
  return text.replace(/^(\s*)(#{1,6}\s)/, '$1\\$2');
}

/**
 * anydoc's GFM → the structure-preserving text the chunker expects.
 *
 * Headings stay as ATX markers (the chunker's `heading_path` contract). Tables
 * collapse to one `a | b | c` line per row: this engine does not use
 * `remark-gfm`, so a GFM table is not a table to `remark` at all and anydoc's
 * delimiter rows would otherwise be indexed as literal `| --- | --- |` text.
 * List items become one line each with the marker dropped, and block quotes
 * lose their `>`; both keep their text.
 */
export function normalizeAnydocMarkdown(md: string): string {
  const out: string[] = [];
  let inFence = false;

  for (const raw of md.split('\n')) {
    const line = raw.replace(/\r$/, '');

    // Fenced code blocks are verbatim: a `|` or `-` inside one is code, not a
    // table row or a list marker.
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (TABLE_DELIMITER.test(trimmed)) {
      // Structural only — carries no content.
      continue;
    }

    if (TABLE_ROW.test(trimmed) && trimmed.length > 2) {
      const cells = splitRow(trimmed);
      // anydoc emits an empty leading header row (`|  |  |  |`) when the source
      // table declares no header row of its own, demoting the real first row
      // into the body. Dropping all-empty rows removes that artifact without
      // touching a row that has content.
      if (cells.every((c) => c.length === 0)) continue;
      out.push(neutralize(cells.join(' | ')));
      continue;
    }

    const marker = LIST_MARKER.exec(line);
    if (marker) {
      const item = line.slice(marker[0].length).trim();
      if (item) out.push(neutralize(item));
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoted = line.replace(/^\s*>+\s?/, '').trim();
      if (quoted) out.push(neutralize(quoted));
      continue;
    }

    out.push(line);
  }

  const collapsed = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return dropRepeatedHeadings(collapsed);
}

/**
 * Drop a heading that immediately repeats the one before it.
 *
 * EPUB carries its title twice — once as OPF `dc:title` metadata and again as
 * the chapter's own `<h1>` — and anydoc faithfully emits both. Left in, the
 * chunker opens a section for the first, finds no body text before the second,
 * and emits a chunk that is a bare duplicated title: an entry in the index with
 * nothing to retrieve.
 */
function dropRepeatedHeadings(text: string): string {
  const kept: string[] = [];
  let lastHeading: string | null = null;

  for (const line of text.split('\n')) {
    if (ATX_HEADING.test(line.trim())) {
      const key = line.trim();
      if (key === lastHeading) continue;
      lastHeading = key;
      kept.push(line);
      continue;
    }
    // Only a blank line may sit between the two copies; any real content means
    // the later heading opens a genuine new section.
    if (line.trim() !== '') lastHeading = null;
    kept.push(line);
  }

  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** First ATX heading in the flattened text, if any. */
function firstHeading(plain: string): string | null {
  for (const line of plain.split('\n')) {
    const text = ATX_HEADING.exec(line.trim())?.[2]?.trim();
    if (text) return text;
  }
  return null;
}

export function createAnydocDocumentParser(opts: AnydocParserOptions = {}): DocumentParser {
  const formats = opts.formats ?? [];
  const onFailure = opts.onFailure ?? 'warn';
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  const extensions = formats.flatMap((f) => [...ANYDOC_FORMAT_EXTENSIONS[f]]);

  // Reuse the untouched markdown pipeline for structure extraction.
  const markdown = createRemarkParser();

  // Lazily imported and memoized: anydoc is an optional peer dependency, so
  // importing it at module load would break markdown ingestion — the default
  // install — for everyone who never asked for another format.
  let modPromise: Promise<AnydocModule> | null = null;

  async function getAnydoc(): Promise<AnydocModule> {
    if (!modPromise) {
      modPromise = (async () => {
        let mod: unknown;
        try {
          mod = await import('@firecrawl/anydoc');
        } catch (err) {
          throw new Error(
            `Ingesting ${formats.map((f) => `"${f}"`).join('/')} requires the optional ` +
              `dependency "@firecrawl/anydoc". Install it with: npm install @firecrawl/anydoc. ` +
              `Alternatively set index.formats to ["md"] in remember.config.ts to index ` +
              `markdown only. Underlying error: ${(err as Error).message}`,
          );
        }
        const resolved = mod as Partial<AnydocModule> & { default?: Partial<AnydocModule> };
        const toMarkdownBytes = resolved.toMarkdownBytes ?? resolved.default?.toMarkdownBytes;
        const formatFromExtension =
          resolved.formatFromExtension ?? resolved.default?.formatFromExtension;
        if (typeof toMarkdownBytes !== 'function' || typeof formatFromExtension !== 'function') {
          throw new Error(
            'Loaded "@firecrawl/anydoc" but it does not expose toMarkdownBytes()/' +
              'formatFromExtension(). Reinstall it with: npm install @firecrawl/anydoc.',
          );
        }
        return { toMarkdownBytes, formatFromExtension };
      })();
    }
    return modPromise;
  }

  return {
    kind: 'document',
    extensions,
    // Every format here is a binary container (a zip, an OLE stream) or a text
    // format whose encoding anydoc detects itself, which is strictly better than
    // letting the walker assume utf8.
    binaryExtensions: extensions,
    async parseDocument({ path: filePath, content }): Promise<ParsedDocument> {
      if (typeof content === 'string') {
        // Wiring guard: a zip container read as utf8 is unrecoverable. This can
        // only happen if the extension is missing from the walker's
        // binaryExtensions — a bug createFormatRouter prevents — so fail loudly
        // rather than index mojibake.
        throw new Error(
          `Document content for "${filePath}" arrived as a string; it must be delivered as ` +
            `bytes. Ensure its extension is listed in the walker's binaryExtensions.`,
        );
      }

      if (maxBytes > 0 && content.byteLength > maxBytes) {
        if (onFailure === 'warn') {
          warn(
            `"${filePath}" is ${content.byteLength} bytes, over the ${maxBytes}-byte limit — ` +
              `recorded with no searchable text.`,
          );
        }
        return markdown.parse('');
      }

      const { toMarkdownBytes, formatFromExtension } = await getAnydoc();

      // Name the format from the extension rather than letting anydoc sniff the
      // content: detection returns null for signature-less formats (CSV), and
      // being explicit keeps dispatch identical to what the walker was told to
      // deliver — a `.csv` never silently converts as something else.
      const format = formatFromExtension(extensionOf(filePath));

      let md: string;
      try {
        md = await toMarkdownBytes(content, format);
      } catch (err) {
        // Corrupt, encrypted or mislabeled input is ordinary in a real corpus and
        // must not cost the run an error.
        if (onFailure === 'warn') {
          warn(
            `"${filePath}" could not be converted (${(err as Error).message}); recorded with ` +
              `no searchable text.`,
          );
        }
        return markdown.parse('');
      }

      const normalized = normalizeAnydocMarkdown(md ?? '');

      if (normalized.length === 0) {
        if (onFailure === 'warn') {
          warn(
            `"${filePath}" converted to no text — recorded with no searchable content. ` +
              `An image-only or empty document needs OCR to be findable.`,
          );
        }
        return markdown.parse('');
      }

      const parsed = markdown.parse(normalized);

      // These formats carry no frontmatter, so the first heading is the only
      // title signal available; without it the page falls back to its filename.
      //
      // Read it off `parsed.plain`, not the normalized markdown: RTF (and any
      // source that bolds its headings) yields `# **Secrets management**`, and
      // the raw line would put literal asterisks into indexed metadata.
      const heading = firstHeading(parsed.plain);
      if (heading) {
        const fm = parsed.frontmatter as Record<string, unknown>;
        if (typeof fm.title !== 'string' || !fm.title.trim()) {
          fm.title = sanitizeTitle(heading);
        }
      }

      return parsed;
    },
  };
}

/** Lowercased extension including the dot, or `''` when there is none. */
function extensionOf(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}
