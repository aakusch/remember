import { describe, it, expect } from 'vitest';
import { createRemarkParser } from '../src/parsers/remark.js';

describe('RemarkParser', () => {
  it('extracts frontmatter via gray-matter', () => {
    const p = createRemarkParser();
    const r = p.parse(`---\ntitle: Hello\ntags: [a, b]\n---\n\n# Body`);
    expect(r.frontmatter).toEqual({ title: 'Hello', tags: ['a', 'b'] });
    expect(r.plain).toContain('Body');
  });

  it('returns mdast ast and plain text', () => {
    const p = createRemarkParser();
    const r = p.parse('# Heading\n\nA paragraph with **bold**.');
    expect(r.ast).toBeTruthy();
    expect(r.plain).toContain('Heading');
    expect(r.plain).toContain('paragraph');
    expect(r.plain).toContain('bold');
  });

  it('handles empty input', () => {
    const p = createRemarkParser();
    const r = p.parse('');
    expect(r.plain).toBe('');
    expect(r.frontmatter).toEqual({});
  });

  it('strips prototype-pollution keys from frontmatter', () => {
    const p = createRemarkParser();
    const r = p.parse('---\n__proto__:\n  polluted: true\ntitle: Safe\n---\n\n# Body');
    // The dangerous own-key is dropped; legitimate keys survive.
    expect(Object.prototype.hasOwnProperty.call(r.frontmatter, '__proto__')).toBe(false);
    expect(r.frontmatter.title).toBe('Safe');
    // And no pollution leaked onto Object.prototype.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
