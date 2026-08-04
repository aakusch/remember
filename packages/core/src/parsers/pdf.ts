import type { DocumentParser, ParsedDocument } from '../types.js';
import { createRemarkParser } from './remark.js';

/**
 * PDF → structured plain text.
 *
 * Strategy: `@firecrawl/pdf-inspector` (a local, no-LLM Rust/napi binding)
 * classifies the PDF and converts native-text pages to markdown — ATX `#`
 * headings from font-size ratios, blank-line-separated blocks, pipe-tables. That
 * markdown is exactly the chunker's `heading_path` contract, so it feeds the
 * untouched markdown pipeline and headings populate `heading_path` with no
 * PDF-specific structure logic (the DOCX→HTML trick, but PDF→markdown).
 *
 * ## Scope (documented, not silently exceeded)
 *
 * 1. **Native-text PDFs only.** `Scanned` / `ImageBased` PDFs carry no
 *    extractable text; they need OCR, which is out of scope here. Such a PDF is
 *    recorded as an empty (0-chunk) page and a warning names the file, rather
 *    than being silently dropped or indexed as garbage.
 * 2. **`Mixed` PDFs are indexed for the text pages they do have;** pages in
 *    `pagesNeedingOcr` contribute nothing and are noted.
 * 3. **Never throws on document data.** Scanned and corrupt PDFs are common, not
 *    an edge case, and a scanned PDF is not an error the operator should have to
 *    triage. So any extraction
 *    failure degrades to an empty page + warning; it never aborts indexing.
 *    (The only throws are the bytes-vs-string wiring guard and the missing
 *    optional-dependency error, both configuration bugs, not per-file data.)
 * 4. Heading/table detection is heuristic (font ratios, rectangle grids); on
 *    poorly-authored PDFs structure degrades to correct text with a flatter
 *    `heading_path`, the same failure shape a direct-formatted DOCX heading has.
 */
export interface PdfParserOptions {
  /**
   * What to do with a PDF that has no extractable text (needs OCR) or fails to
   * parse: `'warn'` (default) records an empty page and prints a stderr warning
   * naming the file; `'silent'` records the empty page without the warning.
   * Neither ever throws.
   */
  onNeedsOcr?: 'warn' | 'silent';
  /**
   * Hard byte ceiling on a single PDF. Above it the file is recorded as an empty
   * page rather than handed to the (synchronous, uninterruptible) native parser
   * — a defense-in-depth memory/CPU bound for callers that read a file directly
   * (e.g. the `GET /v1/pages/<path>` extraction path) and so bypass the walker's
   * own `maxFileBytes` skip. Default 20 MiB. Set to `0` to disable.
   */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

/** Recovered PDF titles are indexed metadata: keep them one-line and bounded. */
function sanitizeTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 300);
}

type PdfType = 'TextBased' | 'Scanned' | 'ImageBased' | 'Mixed';

interface PdfResult {
  pdfType: PdfType;
  markdown?: string;
  pageCount: number;
  /** 1-indexed pages that need OCR. */
  pagesNeedingOcr: number[];
  title?: string;
  /** True when extracted text is likely garbled (GID fonts, missing ToUnicode). */
  hasEncodingIssues?: boolean;
}

/** The single napi export we depend on, narrowed to what this parser uses. */
type PdfInspector = {
  processPdf: (buffer: Buffer, pages?: number[] | null) => PdfResult;
};

function warn(message: string): void {
  process.stderr.write(`[remember] ${message}\n`);
}

export function createPdfDocumentParser(opts: PdfParserOptions = {}): DocumentParser {
  const onNeedsOcr = opts.onNeedsOcr ?? 'warn';
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  // Reuse the untouched markdown pipeline for structure extraction — see the
  // header note. pdf-inspector already emits markdown, so unlike DOCX (which
  // routes through the HTML extractor) there is no intermediate format.
  const markdown = createRemarkParser();

  // Lazily imported and memoized, mirroring parsers/docx.ts (mammoth): the
  // native binding is an optional dependency, so importing it at module load
  // would break md/html/docx ingestion for anyone who installed without it.
  let modPromise: Promise<PdfInspector> | null = null;

  async function getInspector(): Promise<PdfInspector> {
    if (!modPromise) {
      modPromise = (async () => {
        let mod: unknown;
        try {
          mod = await import('@firecrawl/pdf-inspector');
        } catch (err) {
          throw new Error(
            `PDF ingestion requires the optional dependency "@firecrawl/pdf-inspector". ` +
              `Install it with: npm install @firecrawl/pdf-inspector. ` +
              `Alternatively remove "pdf" from index.formats in remember.config.ts to keep indexing the other formats. ` +
              `Underlying error: ${(err as Error).message}`,
          );
        }
        const fn =
          (mod as { processPdf?: PdfInspector['processPdf'] }).processPdf ??
          (mod as { default?: PdfInspector }).default?.processPdf;
        if (typeof fn !== 'function') {
          throw new Error(
            'PDF ingestion loaded "@firecrawl/pdf-inspector" but it does not expose processPdf(). ' +
              'Reinstall it with: npm install @firecrawl/pdf-inspector.',
          );
        }
        return { processPdf: fn };
      })();
    }
    return modPromise;
  }

  return {
    kind: 'document',
    extensions: ['.pdf'],
    binaryExtensions: ['.pdf'],
    async parseDocument({ path, content }): Promise<ParsedDocument> {
      if (typeof content === 'string') {
        // Wiring guard: a PDF read as utf8 is corrupt bytes. This can only happen
        // if ".pdf" is missing from the walker's binaryExtensions — a bug that
        // createFormatRouter prevents — so fail loudly rather than index mojibake.
        throw new Error(
          `PDF content for "${path}" arrived as a string; it must be delivered as bytes. ` +
            `Ensure ".pdf" is listed in the walker's binaryExtensions.`,
        );
      }

      if (maxBytes > 0 && content.byteLength > maxBytes) {
        // Defense in depth for callers that bypass the walker's own size skip
        // (e.g. a direct /v1/pages read): the native parse is synchronous and
        // cannot be interrupted, so bound its input rather than risk a huge PDF
        // stalling the process.
        if (onNeedsOcr === 'warn') {
          warn(
            `PDF "${path}" is ${content.byteLength} bytes, over the ${maxBytes}-byte limit — ` +
              `recorded with no searchable text.`,
          );
        }
        return markdown.parse('');
      }

      const { processPdf } = await getInspector();

      let result: PdfResult;
      try {
        result = processPdf(Buffer.from(content));
      } catch (err) {
        // A corrupt/encrypted/exotic PDF must not abort the whole index run.
        if (onNeedsOcr === 'warn') {
          warn(
            `PDF "${path}" could not be parsed (${(err as Error).message}); ` +
              `recorded with no searchable text.`,
          );
        }
        return markdown.parse('');
      }

      const md = (result.markdown ?? '').trim();
      const isImageOnly = result.pdfType === 'Scanned' || result.pdfType === 'ImageBased';

      if (md.length === 0 || isImageOnly) {
        if (onNeedsOcr === 'warn') {
          warn(
            `PDF "${path}" is ${result.pdfType} with no extractable text — it needs OCR and was ` +
              `recorded with no searchable content. Run OCR (or convert it to text) to make it findable.`,
          );
        }
        return markdown.parse('');
      }

      // Note: `pagesNeedingOcr` is NOT a "content was dropped" signal — pdf-inspector
      // flags pages whose text is *potentially* unreliable yet still returns their
      // markdown, so a clean text PDF routinely reports needsOcr pages. We only
      // degrade when the markdown is actually empty (handled above); a non-empty
      // extraction is indexed as-is and does not warrant a per-file warning.
      if (onNeedsOcr === 'warn' && result.hasEncodingIssues) {
        // This one is real and actionable: the fonts lack ToUnicode / use GID
        // encoding, so the extracted text is likely garbled (mojibake) even though
        // it is non-empty. Index it, but tell the operator it may be unreliable.
        warn(
          `PDF "${path}" has font-encoding issues — extracted text may be garbled. ` +
            `Re-export it with embedded/ToUnicode fonts for reliable search.`,
        );
      }

      const parsed = markdown.parse(md);

      // pdf-inspector can recover a document title from font metadata. Use it only
      // when the extracted markdown carried no title of its own, so the page is
      // not left to fall back to its filename.
      const recovered = typeof result.title === 'string' ? sanitizeTitle(result.title) : '';
      if (recovered) {
        const fm = parsed.frontmatter as Record<string, unknown>;
        if (typeof fm.title !== 'string' || !fm.title.trim()) {
          fm.title = recovered;
        }
      }

      return parsed;
    },
  };
}
