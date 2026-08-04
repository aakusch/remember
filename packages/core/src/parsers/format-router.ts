import path from 'node:path';
import type { DocumentParser, ParsedDocument } from '../types.js';
import { createRemarkParser } from './remark.js';
import { createPdfDocumentParser, type PdfParserOptions } from './pdf.js';
import {
  ANYDOC_FORMAT_NAMES,
  createAnydocDocumentParser,
  type AnydocFormatName,
  type AnydocParserOptions,
} from './anydoc.js';

export const SUPPORTED_FORMATS = ['md', 'pdf', ...ANYDOC_FORMAT_NAMES] as const;
export type FormatName = (typeof SUPPORTED_FORMATS)[number];

/** True for every format `@firecrawl/anydoc` converts — everything but md and pdf. */
function isAnydocFormat(name: FormatName): name is AnydocFormatName {
  return (ANYDOC_FORMAT_NAMES as readonly string[]).includes(name);
}

export interface FormatRouterOptions {
  /**
   * Formats to ingest. Defaults to `['md']` so an unconfigured install walks and
   * parses exactly what it did before multi-format support — that default is
   * load-bearing, not cosmetic.
   */
  formats?: FormatName[];
  pdf?: PdfParserOptions;
  /**
   * Applies to every anydoc-backed format at once: they share one parser
   * instance so the native module is imported and memoized once.
   */
  anydoc?: Omit<AnydocParserOptions, 'formats'>;
}

export interface FormatRouter {
  parser: DocumentParser;
  /** Feed straight into the walker's `extensions`. */
  extensions: string[];
  /** Feed straight into the walker's `binaryExtensions`. */
  binaryExtensions: string[];
  formats: FormatName[];
}

/**
 * Markdown as a `DocumentParser`, wrapping the untouched legacy `Parser`.
 *
 * The legacy interface stays exactly as published — this adapter is the only
 * thing that knows both shapes, so markdown behaviour is bit-identical to the
 * pre-multi-format pipeline.
 */
function createMarkdownDocumentParser(): DocumentParser {
  const legacy = createRemarkParser();
  return {
    kind: 'document',
    extensions: ['.md', '.markdown'],
    binaryExtensions: [],
    async parseDocument({ path: filePath, content }) {
      if (typeof content !== 'string') {
        throw new Error(
          `Markdown content for "${filePath}" arrived as bytes; expected a utf8 string.`,
        );
      }
      return legacy.parse(content);
    },
  };
}

/**
 * Composes per-format parsers into one `DocumentParser` that dispatches on file
 * extension, and reports the extension sets the walker needs so the two can
 * never drift out of sync (a walker that yields a `.pptx` to a router that does
 * not handle it, or withholds one it does, is the failure mode this return shape
 * prevents).
 */
export function createFormatRouter(opts: FormatRouterOptions = {}): FormatRouter {
  const formats = opts.formats ?? ['md'];
  for (const f of formats) {
    if (!(SUPPORTED_FORMATS as readonly string[]).includes(f)) {
      throw new Error(
        `Unknown index format "${f}". Supported formats: ${SUPPORTED_FORMATS.join(', ')}.`,
      );
    }
  }
  // Deduplicate while preserving declared order — first format claiming an
  // extension wins, which makes the mapping deterministic.
  const ordered = [...new Set(formats)];

  // One shared anydoc parser for every enabled non-markdown format. Built lazily
  // so a md-only router constructs nothing extra, and from the full enabled set
  // so its `extensions` are complete on first use.
  let anydocParser: DocumentParser | null = null;
  const anydoc = (): DocumentParser => {
    if (!anydocParser) {
      anydocParser = createAnydocDocumentParser({
        ...(opts.anydoc ?? {}),
        formats: ordered.filter(isAnydocFormat),
      });
    }
    return anydocParser;
  };

  const byExtension = new Map<string, DocumentParser>();
  const extensions: string[] = [];
  const binaryExtensions: string[] = [];

  for (const name of ordered) {
    const parser =
      name === 'md'
        ? createMarkdownDocumentParser()
        : name === 'pdf'
          ? createPdfDocumentParser(opts.pdf ?? {})
          : anydoc();
    const binary = new Set(parser.binaryExtensions.map((e) => e.toLowerCase()));
    for (const rawExt of parser.extensions) {
      const ext = rawExt.toLowerCase();
      if (byExtension.has(ext)) continue;
      byExtension.set(ext, parser);
      extensions.push(ext);
      if (binary.has(ext)) binaryExtensions.push(ext);
    }
  }

  const router: DocumentParser = {
    kind: 'document',
    extensions,
    binaryExtensions,
    async parseDocument(input): Promise<ParsedDocument> {
      const ext = path.extname(input.path).toLowerCase();
      const parser = byExtension.get(ext);
      if (!parser) {
        throw new Error(
          `No parser registered for "${input.path}" (extension "${ext}"). ` +
            `Enabled formats: ${ordered.join(', ')}. ` +
            `Add the format to index.formats in remember.config.ts to ingest it.`,
        );
      }
      return parser.parseDocument(input);
    },
  };

  return { parser: router, extensions, binaryExtensions, formats: ordered };
}
