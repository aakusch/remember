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
      const plain = mdastToString(ast);
      return { frontmatter, ast, plain };
    },
  };
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
