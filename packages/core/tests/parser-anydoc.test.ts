import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANYDOC_FORMAT_EXTENSIONS,
  ANYDOC_FORMAT_NAMES,
  createAnydocDocumentParser,
  normalizeAnydocMarkdown,
  type AnydocFormatName,
} from '../src/parsers/anydoc.js';
import { createSmartSplitChunker } from '../src/chunkers/smart-split.js';
import { createFormatRouter } from '../src/parsers/format-router.js';

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/office',
);

const allFormats = [...ANYDOC_FORMAT_NAMES] as AnydocFormatName[];
const parser = createAnydocDocumentParser({ formats: allFormats });
const chunker = () => createSmartSplitChunker({ size: 900, overlap: 0.15 });

async function parseFixture(name: string) {
  const bytes = await fs.readFile(path.join(FIXTURE_ROOT, name));
  return parser.parseDocument({ path: name, content: bytes });
}

async function headingPaths(name: string): Promise<string[][]> {
  return chunker()
    .chunk(await parseFixture(name))
    .map((c) => c.heading_path);
}

describe('anydoc parser — wiring', () => {
  it('claims every extension of every enabled format, as binary', () => {
    const expected = allFormats.flatMap((f) => [...ANYDOC_FORMAT_EXTENSIONS[f]]);
    expect(parser.extensions).toEqual(expected);
    // Every office format is a container whose encoding anydoc detects itself;
    // handing any of them to the walker as utf8 would corrupt the bytes.
    expect(parser.binaryExtensions).toEqual(expected);
  });

  it('claims nothing when no formats are enabled', () => {
    const none = createAnydocDocumentParser();
    expect(none.extensions).toEqual([]);
    expect(none.binaryExtensions).toEqual([]);
  });

  it('claims only the enabled format', () => {
    const rtfOnly = createAnydocDocumentParser({ formats: ['rtf'] });
    expect(rtfOnly.extensions).toEqual(['.rtf']);
    expect(rtfOnly.extensions).not.toContain('.pptx');
  });

  it('claims .docx and .pdf, which this engine has no other parser for', () => {
    // Unlike the pro engine (mammoth for docx, pdf-inspector for pdf), anydoc is
    // this engine's only non-markdown parser, so it owns both.
    expect(parser.extensions).toContain('.docx');
    expect(parser.extensions).toContain('.pdf');
  });

  it('does not claim markdown', () => {
    // A collision here would silently re-route every already-indexed .md file
    // onto a different parser.
    for (const taken of ['.md', '.markdown']) {
      expect(parser.extensions).not.toContain(taken);
    }
  });

  it('rejects string content, naming the walker misconfiguration', async () => {
    // A zip container read as utf8 is unrecoverable, so this is a loud throw
    // rather than a degraded page — it can only be a wiring bug.
    await expect(
      parser.parseDocument({ path: 'deck.pptx', content: 'not bytes' }),
    ).rejects.toThrow(/must be delivered as bytes/);
  });
});

describe('anydoc parser — structure', () => {
  it('maps ODF outline levels onto a nested heading_path', async () => {
    const paths = await headingPaths('access-control.odt');
    expect(paths).toContainEqual(['Access control']);
    expect(paths).toContainEqual(['Access control', 'Requesting access']);
    // Depth 3 proves the hierarchy nests rather than flattening.
    expect(paths).toContainEqual([
      'Access control',
      'Requesting access',
      'Break-glass accounts',
    ]);
    expect(paths).toContainEqual(['Access control', 'Revocation']);
  });

  it('turns PowerPoint slide titles into headings', async () => {
    const paths = await headingPaths('incident-deck.pptx');
    expect(paths).toContainEqual(['Incident response']);
    expect(paths).toContainEqual(['Escalation path']);
    expect(paths).toContainEqual(['Postmortem']);
    expect(paths).toContainEqual(['Severity definitions']);
  });

  it('keeps slide bullets as separate lines', async () => {
    const parsed = await parseFixture('incident-deck.pptx');
    // The bug this guards: `remark.ts`'s toStructuredText flattens a markdown
    // list with mdast-util-to-string, which concatenates items with NO
    // separator — "…immediately." + "Sev2 waits…" would glue into
    // "…immediately.Sev2 waits…". That is why the parser normalizes lists to
    // plain lines before handing the text to remark.
    expect(parsed.plain).toContain('Sev1 pages the on-call engineer immediately.');
    expect(parsed.plain).toContain('Sev2 waits for business hours');
    expect(parsed.plain).not.toMatch(/immediately\.Sev2/);
  });

  it('extracts speaker notes', async () => {
    const parsed = await parseFixture('incident-deck.pptx');
    expect(parsed.plain).toContain('severity is set by impact, never by effort');
  });

  it('reads RTF outline levels and strips bold from the title', async () => {
    const parsed = await parseFixture('secrets-management.rtf');
    // RTF headings arrive as `# **Secrets management**`. The title must be the
    // flattened text — literal asterisks in indexed metadata would surface in
    // the viewer and in every search result.
    expect(parsed.frontmatter['title']).toBe('Secrets management');
    const paths = await headingPaths('secrets-management.rtf');
    expect(paths).toContainEqual(['Secrets management', 'Rotation']);
    expect(paths).toContainEqual(['Secrets management', 'Exceptions']);
  });

  it('reads EPUB chapter structure without duplicating the title chunk', async () => {
    const parsed = await parseFixture('deploy-guide.epub');
    expect(parsed.frontmatter['title']).toBe('Deploy guide');
    const paths = await headingPaths('deploy-guide.epub');
    expect(paths).toContainEqual(['Deploy guide', 'Rollback']);
    expect(paths).toContainEqual(['Deploy guide', 'Freeze windows']);
    // EPUB carries its title twice (OPF dc:title, then the chapter <h1>).
    // Both copies would open a section, the first with no body text, leaving a
    // chunk that is a bare duplicated title with nothing to retrieve.
    const topLevelOnly = paths.filter((p) => p.length === 1 && p[0] === 'Deploy guide');
    expect(topLevelOnly).toHaveLength(1);
  });

  it('derives a title from the first heading', async () => {
    const parsed = await parseFixture('retention-schedule.xlsx');
    expect(parsed.frontmatter['title']).toBe('Retention');
  });
});

describe('anydoc parser — tables', () => {
  it('renders spreadsheet rows one per line, matching the HTML/DOCX convention', async () => {
    const parsed = await parseFixture('retention-schedule.xlsx');
    expect(parsed.plain).toContain('Data class | Retention period | Owner');
    expect(parsed.plain).toContain('Audit logs | 7 years | security');
  });

  it('keeps every worksheet, named by its own heading', async () => {
    const paths = await headingPaths('retention-schedule.xlsx');
    expect(paths).toContainEqual(['Retention']);
    expect(paths).toContainEqual(['Contacts']);
  });

  it('drops the GFM delimiter row and the empty header row anydoc emits', async () => {
    const parsed = await parseFixture('budgets.ods');
    // anydoc emits `|  |  |  |` then `| --- | --- | --- |` when the source table
    // declares no header row, demoting the real first row into the body. Both
    // are structural and would otherwise be indexed as literal text.
    expect(parsed.plain).not.toMatch(/-{3,}/);
    expect(parsed.plain).not.toMatch(/^[|\s]*$/m);
    expect(parsed.plain).toContain('Team | Quarterly budget | Approver');
    expect(parsed.plain).toContain('platform | 120000 USD | cto');
  });

  it('converts CSV, which has no signature to detect', async () => {
    const parsed = await parseFixture('service-catalog.csv');
    expect(parsed.plain).toContain('service | tier | oncall rotation');
    expect(parsed.plain).toContain('checkout-api | tier1 | platform-primary');
    // A quoted cell containing a comma must survive as one cell.
    expect(parsed.plain).toContain('billing-worker | tier2 | finance, then platform');
  });
});

describe('normalizeAnydocMarkdown', () => {
  it('preserves ATX headings, which are the heading_path contract', () => {
    expect(normalizeAnydocMarkdown('# A\n\ntext\n\n### C')).toBe('# A\n\ntext\n\n### C');
  });

  it('escapes a leading # inside a flattened cell or list item', () => {
    // Left alone, remark would read this back as a real heading and it would
    // land in heading_path as a phantom section.
    const out = normalizeAnydocMarkdown('| # not a heading | b |');
    expect(out).toBe('\\# not a heading | b');
  });

  it('does not treat a pipe inside a fenced code block as a table row', () => {
    const src = '```\n| --- | --- |\n| a | b |\n```';
    expect(normalizeAnydocMarkdown(src)).toBe(src);
  });

  it('keeps an escaped pipe as cell content rather than a separator', () => {
    expect(normalizeAnydocMarkdown('| a \\| b | c |')).toBe('a | b | c');
  });

  it('leaves prose that opens like a roman-numeral list alone', () => {
    // GFM can only express `-` and `1.` markers, so anydoc never emits `I.`;
    // matching it would shear the first token off an ordinary sentence.
    expect(normalizeAnydocMarkdown('I. Introduction is a sentence.')).toBe(
      'I. Introduction is a sentence.',
    );
  });

  it('strips list markers including task-list checkboxes', () => {
    expect(normalizeAnydocMarkdown('- [x] done\n- [ ] todo')).toBe('done\ntodo');
    expect(normalizeAnydocMarkdown('1. first\n2) second')).toBe('first\nsecond');
  });

  it('drops block-quote markers but keeps the text', () => {
    expect(normalizeAnydocMarkdown('> quoted line')).toBe('quoted line');
  });

  it('collapses a heading that immediately repeats itself', () => {
    expect(normalizeAnydocMarkdown('# T\n\n# T\n\nbody')).toBe('# T\n\nbody');
  });

  it('keeps a repeated heading that is separated by real content', () => {
    const src = '# T\n\nbody\n\n# T\n\nmore';
    expect(normalizeAnydocMarkdown(src)).toBe(src);
  });

  it('returns empty for empty input', () => {
    expect(normalizeAnydocMarkdown('')).toBe('');
    expect(normalizeAnydocMarkdown('\n\n  \n')).toBe('');
  });
});

describe('anydoc parser — never throws on document data', () => {
  // The indexer has no per-file error recovery: a throw from a parser aborts the
  // whole indexAll run. Corrupt and mislabeled office files are common, so every
  // one of these must degrade to an empty recorded page instead.
  const cases: Array<[string, Buffer]> = [
    ['garbage bytes', Buffer.from('this is not a document at all')],
    ['zero-byte', Buffer.alloc(0)],
    ['truncated zip', Buffer.from('PKbroken')],
    ['html mislabeled as .pptx', Buffer.from('<html><body>hi</body></html>')],
  ];

  for (const [label, bytes] of cases) {
    it(`records an empty page for ${label}`, async () => {
      const silent = createAnydocDocumentParser({ formats: allFormats, onFailure: 'silent' });
      const parsed = await silent.parseDocument({ path: `broken.pptx`, content: bytes });
      expect(parsed.plain).toBe('');
      expect(chunker().chunk(parsed)).toHaveLength(0);
    });
  }

  it('warns by default, naming the file', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await parser.parseDocument({ path: 'reports/broken.xlsx', content: Buffer.alloc(0) });
      const written = spy.mock.calls.map((c) => String(c[0])).join('');
      expect(written).toContain('reports/broken.xlsx');
    } finally {
      spy.mockRestore();
    }
  });

  it('stays silent when told to', async () => {
    const silent = createAnydocDocumentParser({ formats: allFormats, onFailure: 'silent' });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await silent.parseDocument({ path: 'broken.xlsx', content: Buffer.alloc(0) });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('records an empty page above maxBytes without invoking the converter', async () => {
    const tiny = createAnydocDocumentParser({
      formats: allFormats,
      maxBytes: 8,
      onFailure: 'silent',
    });
    const real = await fs.readFile(path.join(FIXTURE_ROOT, 'access-control.odt'));
    const parsed = await tiny.parseDocument({ path: 'access-control.odt', content: real });
    expect(parsed.plain).toBe('');
  });

  it('parses that same document when the limit is disabled', async () => {
    const unlimited = createAnydocDocumentParser({ formats: allFormats, maxBytes: 0 });
    const real = await fs.readFile(path.join(FIXTURE_ROOT, 'access-control.odt'));
    const parsed = await unlimited.parseDocument({
      path: 'access-control.odt',
      content: real,
    });
    expect(parsed.plain).toContain('Access control');
  });
});

describe('anydoc parser — documented limits', () => {
  it('yields no heading_path for a spreadsheet with no sheet-level structure', async () => {
    // A .ods/.csv is rows, not sections. Recorded so a regression that starts
    // inventing headings is visible, and because the honest product answer is
    // that spreadsheets retrieve poorly — see the parser header note.
    const paths = await headingPaths('budgets.ods');
    expect(paths).toEqual([[]]);
  });

  it('yields no heading_path for an ODF presentation', async () => {
    // ODP text boxes are draw:frame elements with no heading semantics at all,
    // unlike PPTX where the slide title is a real placeholder. The text is
    // indexed correctly; the structure simply is not in the container.
    const paths = await headingPaths('onboarding-overview.odp');
    expect(paths).toEqual([[]]);
    const parsed = await parseFixture('onboarding-overview.odp');
    expect(parsed.plain).toContain('Every new engineer is paired with a buddy');
  });
});

describe('format router integration', () => {
  it('exposes every anydoc format as a config format name', () => {
    const router = createFormatRouter({ formats: ['md', ...allFormats] });
    expect(router.formats).toEqual(['md', ...allFormats]);
    for (const ext of ['.pptx', '.xlsx', '.odt', '.rtf', '.epub', '.csv', '.doc']) {
      expect(router.extensions).toContain(ext);
      expect(router.binaryExtensions).toContain(ext);
    }
    // md stays text.
    expect(router.binaryExtensions).not.toContain('.md');
  });

  it('routes each extension to a parser that can read it', async () => {
    const router = createFormatRouter({ formats: ['md', 'pptx'] });
    const bytes = await fs.readFile(path.join(FIXTURE_ROOT, 'incident-deck.pptx'));
    const parsed = await router.parser.parseDocument({
      path: 'decks/incident-deck.pptx',
      content: bytes,
    });
    expect(parsed.frontmatter['title']).toBe('Incident response');
  });

  it('leaves an extension unclaimed when its format is not enabled', () => {
    const router = createFormatRouter({ formats: ['md'] });
    expect(router.extensions).not.toContain('.pptx');
  });

  it('shares one parser instance across the office formats', () => {
    // They are one lazy native import; N instances would import N times and
    // each would report only its own extensions to the walker.
    const router = createFormatRouter({ formats: ['rtf', 'csv'] });
    expect(router.extensions).toEqual(expect.arrayContaining(['.rtf', '.csv']));
  });

  it('rejects an unknown format name, listing what is supported', () => {
    expect(() => createFormatRouter({ formats: ['nope' as never] })).toThrow(
      /Unknown index format "nope"/,
    );
  });
});
