import type { Chunk, Chunker } from '../types.js';

export interface SmartSplitOptions {
  size?: number; // target chunk size in tokens
  overlap?: number; // overlap fraction (0 - 0.5)
  charsPerToken?: number; // approximation; default 4
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

export function createSmartSplitChunker(opts: SmartSplitOptions = {}): Chunker {
  const size = opts.size ?? 900;
  const overlap = opts.overlap ?? 0.15;
  const charsPerToken = opts.charsPerToken ?? 4;
  const targetChars = size * charsPerToken;
  const overlapChars = Math.floor(targetChars * overlap);

  return {
    chunk({ plain }) {
      if (!plain.trim()) return [];

      // 1. Split into sections by heading lines, preserving the current heading_path.
      const sections = splitByHeadings(plain);

      // 2. For each section, recursively split by paragraph → sentence → chars until each piece fits.
      const pieces: Array<{ heading_path: string[]; text: string }> = [];
      for (const section of sections) {
        for (const piece of recursiveSplit(section.text, targetChars)) {
          pieces.push({ heading_path: section.heading_path, text: piece });
        }
      }

      // 3. Apply overlap: prepend the tail of the previous chunk to the current chunk.
      const chunks: Chunk[] = [];
      let prevTail = '';
      let prevHeadingPath: string[] = [];
      for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i]!;
        const text =
          prevTail && piece.heading_path.join('|') === prevHeadingPath.join('|')
            ? `${prevTail}\n\n${piece.text}`
            : piece.text;
        chunks.push({
          id: '', // filled by indexer
          source_path: '', // filled by indexer
          chunk_idx: i,
          text,
          heading_path: piece.heading_path,
        });
        prevTail = overlapChars > 0 ? piece.text.slice(-overlapChars) : '';
        prevHeadingPath = piece.heading_path;
      }
      return chunks;
    },
  };
}

interface Section {
  heading_path: string[];
  text: string;
}

function splitByHeadings(plain: string): Section[] {
  const lines = plain.split('\n');
  const sections: Section[] = [];
  let currentText: string[] = [];
  const headingStack: { depth: number; title: string }[] = [];

  const flushSection = () => {
    const text = currentText.join('\n').trim();
    if (text) {
      sections.push({ heading_path: headingStack.map((h) => h.title), text });
    }
    currentText = [];
  };

  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m && m[1] && m[2]) {
      flushSection();
      const depth = m[1].length;
      while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.depth >= depth) {
        headingStack.pop();
      }
      headingStack.push({ depth, title: m[2].trim() });
      currentText.push(line);
    } else {
      currentText.push(line);
    }
  }
  flushSection();

  if (sections.length === 0 && plain.trim()) {
    return [{ heading_path: [], text: plain.trim() }];
  }
  return sections;
}

function recursiveSplit(text: string, targetChars: number): string[] {
  if (text.length <= targetChars) {
    return [text];
  }

  // Try paragraph boundaries first.
  const paragraphs = text.split(/\n\s*\n/);
  if (paragraphs.length > 1) {
    return packIntoChunks(paragraphs, targetChars, '\n\n');
  }

  // Then sentence boundaries.
  const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) ?? [text];
  if (sentences.length > 1) {
    return packIntoChunks(sentences.map((s) => s.trim()), targetChars, ' ');
  }

  // Last resort: hard split.
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += targetChars) {
    chunks.push(text.slice(i, i + targetChars));
  }
  return chunks;
}

function packIntoChunks(pieces: string[], targetChars: number, joiner: string): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let bufLen = 0;
  for (const p of pieces) {
    const len = p.length + joiner.length;
    if (bufLen + len > targetChars && buf.length > 0) {
      out.push(buf.join(joiner).trim());
      buf = [];
      bufLen = 0;
    }
    if (p.length > targetChars) {
      // Oversized single piece — recurse to break it down.
      if (buf.length > 0) {
        out.push(buf.join(joiner).trim());
        buf = [];
        bufLen = 0;
      }
      out.push(...recursiveSplit(p, targetChars));
    } else {
      buf.push(p);
      bufLen += len;
    }
  }
  if (buf.length > 0) {
    out.push(buf.join(joiner).trim());
  }
  return out.filter((s) => s.length > 0);
}
