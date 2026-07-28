/**
 * Query-aware snippet extraction.
 *
 * Given a chunk of text and the user's query, return a ~280-char passage that
 * (1) contains as many distinct query terms as possible, (2) starts and ends
 * on sentence boundaries, and (3) leads with "…" if it's a slice from the
 * middle of a longer chunk.
 *
 * Without a query, falls back to the first ~280 chars trimmed to a sentence
 * boundary — same shape as the old truncate-to-280 behaviour, just smarter
 * about where to cut.
 *
 * When the best-scoring unit is itself longer than the cap — a table, a bullet
 * list, or a run-on note with no sentence punctuation — sentence windowing has
 * nothing to slice on, so a char-level window slides onto the query terms
 * instead of returning the head (which the card clamp would otherwise crop the
 * terms out of). Presentation only: never changes score, order, or chunk ids.
 *
 * Not a full BM25-passage scorer — that would need term frequencies and IDF.
 * Distinct-term coverage is the cheapest signal that handles 90% of queries.
 */

export interface ExtractSnippetOptions {
  /** Hard cap on the returned snippet length, before adding ellipsis chars. */
  maxLen?: number;
}

const DEFAULT_MAX = 280;

// Cheap English stopword set. Filtered out of the query so common words don't
// outweigh meaningful terms. Not aiming for linguistic completeness here —
// this just keeps `"is"` or `"the"` from dominating the score.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'for', 'from',
  'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of',
  'on', 'or', 'so', 'the', 'this', 'to', 'was', 'we',
  'which', 'will', 'with', 'you', 'your',
]);

// Question words trigger entity-class scoring (boost sentences containing
// what the question is asking for). Kept OUT of STOPWORDS so we can detect
// them in the raw query; the tokenizer drops them after intent detection.
const QUESTION_WORDS = new Set(['when', 'where', 'who', 'whom', 'how', 'what', 'why', 'which']);

type Intent = 'when' | 'where' | 'who' | 'count' | 'none';

/**
 * Detect what kind of answer the query is asking for, if it's a question.
 * Returns 'none' for non-question queries so they don't get a misleading
 * entity-class boost.
 */
function detectIntent(query: string): Intent {
  const tokens = query.toLowerCase().split(/\s+/);
  const first = tokens[0] ?? '';
  if (first === 'when') return 'when';
  if (first === 'where') return 'where';
  if (first === 'who' || first === 'whom') return 'who';
  if (first === 'how' && (tokens[1] === 'many' || tokens[1] === 'much')) return 'count';
  // "in what year" → when
  if (tokens.includes('year') && (first === 'what' || first === 'which')) return 'when';
  return 'none';
}

// Regex patterns that signal sentences containing entities for each intent.
// Crude but effective — a 4-digit year is a year, a century mention is a date,
// a number followed by "BC" is a date, etc.
const YEAR_RE = /\b\d{1,4}\s*(?:BCE?|CE|AD|A\.D\.|B\.C\.|century|centuries)\b|\b\d{3,4}\b/i;
const PLACE_RE = /\b(?:in|at|near|from|of)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/;
const PERSON_RE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/; // First Last
const NUMBER_RE = /\b\d+(?:,\d{3})*(?:\.\d+)?\b/;

export function extractSnippet(
  text: string,
  query: string | undefined | null,
  opts: ExtractSnippetOptions = {},
): string {
  const maxLen = opts.maxLen ?? DEFAULT_MAX;
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;

  const intent = detectIntent(query ?? '');
  const terms = tokenizeQuery(query ?? '');
  if (terms.length === 0 && intent === 'none') {
    return fallbackSnippet(trimmed, maxLen);
  }

  const sentences = splitSentences(trimmed);
  if (sentences.length === 0) {
    return fallbackSnippet(trimmed, maxLen);
  }

  // Score each sentence: distinct-term count + entity-class bonus when the
  // query has clear intent (e.g. "when …" boosts sentences with year tokens).
  const scored = sentences.map((s, i) => ({
    idx: i,
    text: s,
    score: scoreSentence(s, terms) + intentBonus(s, intent),
  }));

  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  if (best.score === 0) {
    // No sentence contains any query term or intent match — fall back.
    return fallbackSnippet(trimmed, maxLen);
  }

  // Expand outward from the best sentence, alternating sides, while staying
  // under the max length. Prefer expanding into the higher-scoring neighbour.
  let startIdx = best.idx;
  let endIdx = best.idx;
  let acc = best.text.length;

  while (true) {
    const nextI = endIdx + 1;
    const prevI = startIdx - 1;
    const nextSent = nextI < sentences.length ? sentences[nextI] : null;
    const prevSent = prevI >= 0 ? sentences[prevI] : null;
    const nextScore = nextSent ? scoreSentence(nextSent, terms) : -1;
    const prevScore = prevSent ? scoreSentence(prevSent, terms) : -1;

    // Pick the side with the higher term-score; ties + no-score fall to forward.
    const goForward = nextSent && (nextScore >= prevScore || !prevSent);
    const goBack = prevSent && (prevScore > nextScore || !nextSent);

    if (goForward && nextSent && acc + nextSent.length + 1 <= maxLen) {
      acc += nextSent.length + 1;
      endIdx = nextI;
      continue;
    }
    if (goBack && prevSent && acc + prevSent.length + 1 <= maxLen) {
      acc += prevSent.length + 1;
      startIdx = prevI;
      continue;
    }
    // Try the other side once more even if its score is lower, as long as the
    // length budget allows — better to fill the window than leave it short.
    if (nextSent && acc + nextSent.length + 1 <= maxLen) {
      acc += nextSent.length + 1;
      endIdx = nextI;
      continue;
    }
    if (prevSent && acc + prevSent.length + 1 <= maxLen) {
      acc += prevSent.length + 1;
      startIdx = prevI;
      continue;
    }
    break;
  }

  const window = sentences.slice(startIdx, endIdx + 1).join(' ').trim();
  if (window.length > maxLen) {
    // The best-scoring unit is a single span longer than the cap — a table, a
    // bullet list, or a run-on note with no sentence punctuation to split on.
    // Sentence windowing can't tighten it, and returning it whole means the
    // downstream card clamp cuts to the head, hiding the query terms. Slide a
    // char-level window onto the terms so they stay visible. Presentation only:
    // this branch is unreachable unless a single selected sentence already
    // exceeds maxLen, so ordinary prose snippets are byte-for-byte unchanged.
    return windowAroundTerms(window, terms, maxLen, startIdx > 0);
  }
  const leadEllipsis = startIdx > 0 ? '… ' : '';
  const trailEllipsis = endIdx < sentences.length - 1 ? ' …' : '';
  return leadEllipsis + window + trailEllipsis;
}

/**
 * Char-level windowing for an over-long span with no usable sentence breaks.
 * Slides a `maxLen`-wide window to the densest cluster of query-term matches,
 * snaps the edges to word boundaries, and marks truncation with ellipses.
 * Falls back to the head slice when no term matches — matching the no-signal
 * fallback used elsewhere.
 *
 * `leadFromPriorSentence` is true when the caller already trimmed sentences
 * before this span, so the lead ellipsis is shown even when the window starts
 * at char 0 of the span.
 */
function windowAroundTerms(
  text: string,
  terms: string[],
  maxLen: number,
  leadFromPriorSentence: boolean,
): string {
  const lower = text.toLowerCase();
  const positions: number[] = [];
  for (const t of terms) {
    const re = new RegExp(`\\b${escapeRegex(t)}`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      positions.push(m.index);
      if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width
    }
  }
  if (positions.length === 0) return fallbackSnippet(text, maxLen);
  positions.sort((a, b) => a - b);

  // Pick the window start (anchored at a match) that covers the most matches.
  let bestStart = positions[0]!;
  let bestCount = 0;
  for (const p of positions) {
    const end = p + maxLen;
    let count = 0;
    for (const q of positions) if (q >= p && q < end) count++;
    if (count > bestCount) {
      bestCount = count;
      bestStart = p;
    }
  }

  // Give the first match a little left margin so it isn't flush to the edge.
  let start = Math.max(0, bestStart - 30);
  let end = Math.min(text.length, start + maxLen);
  // Snap the edges to word boundaries so we never cut mid-word.
  if (start > 0) {
    const ws = text.indexOf(' ', start);
    if (ws !== -1 && ws < start + 40) start = ws + 1;
  }
  if (end < text.length) {
    const ws = text.lastIndexOf(' ', end);
    if (ws > start) end = ws;
  }
  const slice = text.slice(start, end).trim();
  const lead = start > 0 || leadFromPriorSentence ? '… ' : '';
  const trail = end < text.length ? ' …' : '';
  return lead + slice + trail;
}

/**
 * Extract a single best-fit sentence from text — distinct from
 * `extractSnippet`, which returns a ~280-char passage. Used by "featured
 * answer" UIs that want one quotable line rather than a paragraph.
 *
 * Returns null when no sentence scores above the confidence threshold (no
 * query terms matched AND no question-intent entity matched). The UI should
 * fall back to the regular snippet card in that case.
 */
export function extractAnswer(
  text: string,
  query: string | undefined | null,
): string | null {
  if (!query?.trim()) return null;
  const intent = detectIntent(query);
  const terms = tokenizeQuery(query);
  if (terms.length === 0 && intent === 'none') return null;

  const sentences = splitSentences(text);
  if (sentences.length === 0) return null;

  let best = sentences[0]!;
  let bestScore = -1;
  for (const s of sentences) {
    const score = scoreSentence(s, terms) + intentBonus(s, intent);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  // Require at least one meaningful match — either a query term hit or an
  // entity that matches the question intent.
  if (bestScore < 1) return null;
  return best;
}

/**
 * Fallback when the query gives us no signal: take the first ~maxLen chars,
 * trimmed to a sentence boundary if one exists before the cap.
 */
function fallbackSnippet(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  // Look for the last sentence end before maxLen.
  const window = text.slice(0, maxLen);
  const m = /[.!?](?=\s|$)/g;
  let last = -1;
  for (const match of window.matchAll(m)) {
    last = match.index + 1;
  }
  if (last > maxLen * 0.5) {
    return window.slice(0, last).trim() + ' …';
  }
  // No sentence boundary, cut on the last word boundary.
  const ws = window.lastIndexOf(' ');
  return (ws > 0 ? window.slice(0, ws) : window).trim() + ' …';
}

/**
 * Lowercase the query, split on non-word boundaries, drop stopwords and
 * sub-3-char tokens. Returns the unique set so duplicates ("deploy deploy")
 * don't double-count.
 */
export function tokenizeQuery(query: string): string[] {
  const raw = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(
      (t) => t.length >= 3 && !STOPWORDS.has(t) && !QUESTION_WORDS.has(t),
    );
  return Array.from(new Set(raw));
}

/**
 * Count distinct query terms appearing in the sentence. Uses word-boundary
 * substring match (case-insensitive) — catches "deploy" → "deployment",
 * "deploys", "deploying" but not "redeploy" (whose preceding `\b` is consumed
 * by the prefix).
 */
function scoreSentence(sentence: string, terms: string[]): number {
  const lower = sentence.toLowerCase();
  let count = 0;
  for (const t of terms) {
    if (new RegExp(`\\b${escapeRegex(t)}`).test(lower)) {
      count++;
    }
  }
  return count;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Bonus score added when a sentence contains the kind of entity the question
 * is asking for. Heuristic — no real NER — but enough to make "when did X
 * happen?" surface a sentence with a year, instead of one with five `X`s.
 *
 * Bonus is 2 (vs. 1 per matched query term) so an entity match outweighs a
 * single keyword match. A keyword-rich sentence with no entity still wins
 * against a sentence with just the entity and no keywords.
 */
function intentBonus(sentence: string, intent: Intent): number {
  switch (intent) {
    case 'when':
      return YEAR_RE.test(sentence) ? 2 : 0;
    case 'where':
      return PLACE_RE.test(sentence) ? 2 : 0;
    case 'who':
      return PERSON_RE.test(sentence) ? 2 : 0;
    case 'count':
      return NUMBER_RE.test(sentence) ? 2 : 0;
    case 'none':
      return 0;
  }
}

/**
 * Split text into sentences. Cuts on sentence-ending punctuation followed by
 * whitespace AND a capital letter — that's the next-sentence-starts-with-caps
 * convention English follows. Avoids false breaks on common abbreviations like
 * "c." (circa), "e.g.", "i.e.", "Dr.", which are followed by lowercase or
 * digits. Markdown paragraph breaks (double newlines) always split.
 *
 * Example of the bug this avoids: "Genghis Khan (born Temüjin; c. 1162 –
 * August 1227)" — the period after "c" is not a sentence boundary because
 * "1162" doesn't start with a capital letter. The old splitter broke it into
 * two short fragments, which the snippet algorithm then under-scored.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])|\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
