import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { toString as mdastToString } from 'mdast-util-to-string';
import type { Parser } from '../types.js';

export function createRemarkParser(): Parser {
  const processor = unified().use(remarkParse);

  return {
    parse(raw: string) {
      const { data: frontmatter, content } = matter(raw);
      const ast = processor.parse(content);
      const plain = mdastToString(ast);
      return { frontmatter: frontmatter as Record<string, unknown>, ast, plain };
    },
  };
}
