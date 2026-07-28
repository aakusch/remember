import { describe, it, expect } from 'vitest';
import {
  extractSnippet,
  extractAnswer,
  tokenizeQuery,
  splitSentences,
} from '../src/search/snippet.js';

describe('tokenizeQuery', () => {
  it('lowercases, splits, drops stopwords + short tokens', () => {
    expect(tokenizeQuery('How do we Deploy to Production?')).toEqual([
      'deploy',
      'production',
    ]);
  });

  it('dedupes repeated terms', () => {
    expect(tokenizeQuery('deploy deploy DEPLOY')).toEqual(['deploy']);
  });

  it('returns [] for whitespace-only', () => {
    expect(tokenizeQuery('   ')).toEqual([]);
  });

  it('handles punctuation and unicode word boundaries', () => {
    expect(tokenizeQuery('postgres-over-mongo, ADR-0042')).toEqual([
      'postgres',
      'over',
      'mongo',
      'adr',
      '0042',
    ]);
  });
});

describe('splitSentences', () => {
  it('splits on sentence-ending punctuation + whitespace', () => {
    const out = splitSentences('First sentence. Second sentence! Third? Yes.');
    expect(out).toEqual(['First sentence.', 'Second sentence!', 'Third?', 'Yes.']);
  });

  it('splits on blank lines (markdown paragraphs)', () => {
    const out = splitSentences('Heading paragraph one\n\nHeading paragraph two');
    expect(out).toEqual(['Heading paragraph one', 'Heading paragraph two']);
  });

  it('does not split on abbreviations like "c." (period followed by digit)', () => {
    const out = splitSentences('Born c. 1162 in Mongolia. He died in 1227.');
    expect(out).toEqual(['Born c. 1162 in Mongolia.', 'He died in 1227.']);
  });

  it('does not split on lowercase continuation (e.g. mid-sentence period)', () => {
    const out = splitSentences('See e.g. the previous chapter. It explains.');
    expect(out).toEqual(['See e.g. the previous chapter.', 'It explains.']);
  });

  it('handles biographical lead with born/died date range', () => {
    const out = splitSentences(
      'Genghis Khan (born Temüjin; c. 1162 – August 1227), also known as Chinggis Khan, was the founder.',
    );
    // The whole biographical lead should be ONE sentence.
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('1162');
    expect(out[0]).toContain('1227');
  });
});

describe('extractSnippet', () => {
  const longText = [
    'The deploy runbook walks through how we ship to production.',
    'Tag the commit, push, wait for CI, promote staging to prod.',
    'Watch the error-rate dashboard for fifteen minutes after promotion.',
    'If anything spikes, roll back immediately and investigate later.',
    'Database migrations are not rolled back automatically.',
    'Post in the deploys channel with the tag and a one-line summary.',
  ].join(' ');

  it('returns short text unchanged when under the cap', () => {
    expect(extractSnippet('hello world', 'hello')).toBe('hello world');
  });

  it('with no query, returns a sentence-trimmed prefix', () => {
    const out = extractSnippet(longText, undefined);
    expect(out.length).toBeLessThanOrEqual(290); // 280 + ellipsis
    expect(out).toContain('The deploy runbook');
    expect(out).toMatch(/(\.\s+…|\s+…)$/); // trails with ellipsis
  });

  it('with a query, centres on the sentence containing query terms', () => {
    const out = extractSnippet(longText, 'rollback database');
    expect(out).toContain('roll back');
    expect(out).toContain('migrations');
  });

  it('expands to neighbours within the length budget', () => {
    const out = extractSnippet(longText, 'production');
    // Should grab the deploy sentence + at least one neighbour.
    expect(out).toContain('production');
    expect(out.length).toBeGreaterThan(70); // more than just the one sentence
  });

  it('adds leading ellipsis when the window starts mid-text', () => {
    const out = extractSnippet(longText, 'migrations');
    expect(out).toMatch(/^…/);
    expect(out).toContain('Database migrations');
  });

  it('falls back when no query term matches anything', () => {
    const out = extractSnippet(longText, 'unrelated topic kubernetes');
    expect(out).toContain('The deploy runbook'); // same as no-query fallback
  });

  it('respects the maxLen option', () => {
    const out = extractSnippet(longText, 'production', { maxLen: 100 });
    expect(out.length).toBeLessThanOrEqual(120); // 100 + ellipsis padding
  });

  // A single over-long span with no sentence breaks (table / list / run-on
  // note). Sentence windowing can't tighten it, so a char window must slide
  // onto the buried query term instead of returning the head.
  const runOnChunk =
    'the quarterly revenue figures were reviewed by the board and the finance team ' +
    'noted that gross margin improved while operating expenses grew faster than ' +
    'expected which pushed the compression ratio metric down but the underlying ' +
    'churn cohort analysis showed retention holding steady across enterprise ' +
    'accounts for the trailing twelve month window ending in June';

  it('windows onto a buried term in a single over-long span', () => {
    const out = extractSnippet(runOnChunk, 'compression ratio', { maxLen: 120 });
    expect(out).toContain('compression ratio'); // term is visible…
    expect(out.length).toBeLessThanOrEqual(130); // …and the span was tightened
    expect(out).not.toMatch(/^the quarterly revenue/); // not the raw head
    expect(out.startsWith('…')).toBe(true); // marked as a mid-span slice
  });

  it('over-long single span still clamps to the cap when the term is at the head', () => {
    const out = extractSnippet(runOnChunk, 'quarterly revenue', { maxLen: 120 });
    expect(out).toContain('quarterly revenue');
    expect(out.length).toBeLessThanOrEqual(130);
    expect(out.startsWith('…')).toBe(false); // starts at the head, no lead ellipsis
    expect(out.endsWith('…')).toBe(true); // …but is truncated on the right
  });

  it('over-long span with no matching term falls back to the head slice', () => {
    const out = extractSnippet(runOnChunk, 'kubernetes deployment', { maxLen: 120 });
    expect(out).toMatch(/^the quarterly revenue/); // head fallback
    expect(out.length).toBeLessThanOrEqual(130);
  });

  it('windows a markdown table onto the matching row', () => {
    const table =
      '| region | latency | notes |\n' +
      '| us-east | 12ms | primary write region |\n' +
      '| eu-west | 40ms | replica only, read traffic |\n' +
      '| ap-south | 90ms | cold standby, promoted during failover drills only |\n' +
      '| sa-east | 110ms | experimental edge node under evaluation for latency workloads |';
    const out = extractSnippet(table, 'failover standby', { maxLen: 120 });
    expect(out).toMatch(/failover|standby/);
    expect(out.length).toBeLessThanOrEqual(130);
  });

  it('handles a single-sentence text gracefully', () => {
    const text = 'A single sentence without internal breaks that still exceeds the typical snippet length cap of two hundred and eighty characters, here is some more padding text to push us well past the cap because we need to verify the fallback path works when there is just one sentence and it is too long to fit.';
    const out = extractSnippet(text, 'sentence');
    expect(out.length).toBeLessThanOrEqual(310);
  });

  it('treats stopword-only queries as no query', () => {
    const out = extractSnippet(longText, 'the and is');
    expect(out).toContain('The deploy runbook'); // no-query fallback path
  });

  it('"when" queries prefer sentences containing year tokens', () => {
    const text = [
      'Rome had a long and complex history.',
      'The empire eventually fell.',
      'The traditional date for the fall is 476 AD.',
      'Many historians debate the exact moment.',
      'Some emphasize the 5th century as a broader process.',
      'Others point to 1453 for the Eastern half.',
    ].join(' ');
    // Without intent boost the snippet might pick a "fall"-heavy sentence
    // without a date. With "when" intent, year-bearing sentences win.
    const out = extractSnippet(text, 'when did rome fall', { maxLen: 200 });
    expect(out).toMatch(/476|1453|5th century/);
  });

  it('"who" queries prefer sentences with proper-noun pairs', () => {
    const text = [
      'The general led many campaigns.',
      'The campaign lasted several years.',
      'Julius Caesar crossed the Rubicon in 49 BC.',
      'The act sparked a civil war.',
    ].join(' ');
    const out = extractSnippet(text, 'who crossed the rubicon', { maxLen: 150 });
    expect(out).toContain('Julius Caesar');
  });

  it('"how many" queries prefer sentences containing numbers', () => {
    const text = [
      'The legion was a notable military unit.',
      'They were known for their discipline.',
      'A standard legion had about 5000 soldiers.',
      'Each soldier carried his own kit.',
    ].join(' ');
    const out = extractSnippet(text, 'how many soldiers in a legion', { maxLen: 150 });
    expect(out).toContain('5000');
  });
});

describe('extractAnswer', () => {
  const romeText = [
    'The fall of the Western Roman Empire was a gradual process.',
    'Historians debate its causes endlessly.',
    'The traditional date for the fall is 476 AD.',
    'Some scholars prefer earlier or later dates.',
  ].join(' ');

  it('returns one best sentence, not a passage', () => {
    const out = extractAnswer(romeText, 'when did rome fall');
    expect(out).toBe('The traditional date for the fall is 476 AD.');
  });

  it('returns null for empty queries', () => {
    expect(extractAnswer(romeText, '')).toBeNull();
    expect(extractAnswer(romeText, '   ')).toBeNull();
    expect(extractAnswer(romeText, null)).toBeNull();
  });

  it('returns null when no sentence matches enough to be an answer', () => {
    expect(extractAnswer(romeText, 'unrelated kubernetes')).toBeNull();
  });

  it('prefers proper-noun sentences for "who" queries', () => {
    const text = 'A general led the army. Julius Caesar crossed the Rubicon in 49 BC. The crossing started a war.';
    expect(extractAnswer(text, 'who crossed the rubicon')).toContain('Julius Caesar');
  });
});
