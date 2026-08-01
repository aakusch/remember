import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { toString as mdastToString } from 'mdast-util-to-string';
import type { Parser } from '../types.js';

export function createRemarkParser(): Parser {
  const processor = unified().use(remarkParse);

  return {
    parse(raw: string) {
      const { data, content } = matter(raw);
      // gray-matter can emit own `__proto__`/`constructor`/`prototype` keys from
      // adversarial frontmatter. Nothing in core deep-merges this object today,
      // but strip the dangerous keys at parse time so the published object is
      // safe for any downstream consumer that might (prototype-pollution guard).
      const frontmatter = stripUnsafeKeys(data as Record<string, unknown>);
      const ast = processor.parse(content);
      const plain = flattenBlocks(ast);
      return { frontmatter, ast, plain };
    },
  };
}

/**
 * Flatten the markdown AST to plain text with readable spacing.
 *
 * `mdast-util-to-string` on the whole tree concatenates every node with NO
 * separator, so a heading and the next paragraph fuse ("wikiThis is…") and list
 * items jam together — which then leaks into search snippets. We keep it simple
 * (no heading markers / structure — that lives in Pro) and just join block-level
 * siblings with blank lines and list items with newlines, so words never run
 * together. Inline text inside a block is already correctly spaced by the source.
 */
function flattenBlocks(node: MdastNode): string {
  if (
    node.type === 'root' ||
    node.type === 'blockquote' ||
    node.type === 'listItem' ||
    node.type === 'footnoteDefinition'
  ) {
    return (node.children ?? []).map(flattenBlocks).filter(Boolean).join('\n\n');
  }
  if (node.type === 'list') {
    return (node.children ?? []).map(flattenBlocks).filter(Boolean).join('\n');
  }
  // Re-emit ATX markers for real headings. `mdast-util-to-string` drops them, but
  // the smart-split chunker detects section boundaries + builds each chunk's
  // heading_path by matching `^#{1,6}\s` on this flattened text. Without the markers
  // heading_path is always empty AND the only lines that look like headings are `#`
  // comments inside code — which the chunker would then hallucinate as headings.
  if (node.type === 'heading') {
    const depth = Math.min(Math.max(node.depth ?? 1, 1), 6);
    return `${'#'.repeat(depth)} ${mdastToString(node).trim()}`;
  }
  // Indent fenced-code content so a `# comment` line inside it can never be read as
  // a section heading (it no longer starts the line). Content stays searchable.
  if (node.type === 'code') {
    return mdastToString(node)
      .split('\n')
      .map((line) => (line ? `    ${line}` : line))
      .join('\n')
      .replace(/\s+$/, '');
  }
  return mdastToString(node).trim();
}

interface MdastNode {
  type: string;
  depth?: number;
  children?: MdastNode[];
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function stripUnsafeKeys(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (UNSAFE_KEYS.has(key)) continue;
    out[key] = data[key];
  }
  return out;
}
