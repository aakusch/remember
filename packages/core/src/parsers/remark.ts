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
      const plain = toStructuredText(ast);
      return { frontmatter, ast, plain };
    },
  };
}

interface MdastNode {
  type: string;
  depth?: number;
  children?: MdastNode[];
}

/**
 * Plain text that still carries block structure.
 *
 * `mdast-util-to-string` alone concatenates every text node with no separator,
 * so "# Deploy runbook\n\nDeploys go out" collapsed to
 * "Deploy runbookDeploys go out" — heading markers and every newline gone. The
 * chunker matches headings with /^#{1,6}\s+/ to build `heading_path` and to
 * split on section boundaries, so it never matched: every chunk in every index
 * had an empty heading_path, disabling applyHeadingBoost entirely and reducing
 * chunking to fixed-size slicing that ignores sections.
 *
 * Headings are re-emitted as markdown and blocks are newline-separated so the
 * chunker sees the structure, while inline markup stays stripped for clean
 * embedding text.
 */
function toStructuredText(ast: unknown): string {
  const root = ast as MdastNode;
  const blocks = root.children ?? [];
  const lines: string[] = [];
  for (const node of blocks) {
    const text = mdastToString(node as never).trim();
    if (!text) continue;
    if (node.type === 'heading') {
      const depth = Math.min(Math.max(node.depth ?? 1, 1), 6);
      lines.push(`${'#'.repeat(depth)} ${text}`);
    } else {
      lines.push(text);
    }
  }
  return lines.join('\n\n');
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
