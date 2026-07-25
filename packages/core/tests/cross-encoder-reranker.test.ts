import { describe, expect, it } from 'vitest';
import { createCrossEncoderReranker } from '../src/rerankers/cross-encoder.js';
import type { RerankedResult, SearchResult } from '../src/types.js';

function hit(p: string, score: number, snippet = '', chunk_idx = 0): SearchResult {
  return {
    path: p,
    chunk_idx,
    snippet,
    frontmatter: {},
    score,
    retrievers: ['bm25'],
    chunk_id: `${p}#${chunk_idx}`,
  };
}

describe('createCrossEncoderReranker', () => {
  it('orders candidates by cross-encoder score, not retrieval score', async () => {
    const reranker = createCrossEncoderReranker({
      // Retrieval put c.md last; the cross-encoder says it is the best match.
      score: async (_query, texts) => texts.map((text) => (text.includes('third') ? 9 : -9)),
    });

    const out = await reranker.rerank('q', [
      hit('a.md', 0.9, 'first'),
      hit('b.md', 0.8, 'second'),
      hit('c.md', 0.1, 'third'),
    ]);

    expect(out.map((r) => r.path)).toEqual(['c.md', 'a.md', 'b.md']);
  });

  it('reports retrieval, reranker, and bounded final scores', async () => {
    const reranker = createCrossEncoderReranker({
      score: async (_query, texts) => texts.map(() => 0),
    });

    const [top] = (await reranker.rerank('q', [hit('a.md', 0.42)])) as RerankedResult[];

    expect(top!.retrievalScore).toBe(0.42);
    expect(top!.rerankerScore).toBe(0);
    // A raw logit is unbounded, which would be a strange public "score";
    // sigmoid(0) === 0.5 keeps it comparable to retrieval scores.
    expect(top!.finalScore).toBeCloseTo(0.5, 6);
    expect(top!.score).toBeCloseTo(0.5, 6);
  });

  it('returns an empty list without invoking the model', async () => {
    let calls = 0;
    const reranker = createCrossEncoderReranker({
      score: async (_query, texts) => {
        calls += 1;
        return texts.map(() => 0);
      },
    });

    expect(await reranker.rerank('q', [])).toEqual([]);
    expect(calls).toBe(0);
  });

  it('reranks only the top N and leaves the tail in retrieval order', async () => {
    const scored: string[] = [];
    const reranker = createCrossEncoderReranker({
      topN: 2,
      score: async (_query, texts) => {
        scored.push(...texts);
        // Invert the two it sees, so a change in order is observable.
        return texts.map((_text, index) => index);
      },
    });

    const out = await reranker.rerank('q', [
      hit('a.md', 0.9, 'alpha'),
      hit('b.md', 0.8, 'bravo'),
      hit('c.md', 0.7, 'charlie'),
      hit('d.md', 0.6, 'delta'),
    ]);

    expect(scored).toEqual(['alpha', 'bravo']);
    expect(out.map((r) => r.path)).toEqual(['b.md', 'a.md', 'c.md', 'd.md']);
  });

  it('keeps retrieval order when the model ties', async () => {
    const reranker = createCrossEncoderReranker({
      score: async (_query, texts) => texts.map(() => 1),
    });

    const out = await reranker.rerank('q', [
      hit('a.md', 0.9),
      hit('b.md', 0.8),
      hit('c.md', 0.7),
    ]);

    expect(out.map((r) => r.path)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('truncates long documents before scoring', async () => {
    let seen = '';
    const reranker = createCrossEncoderReranker({
      maxTextLength: 10,
      score: async (_query, texts) => {
        seen = texts[0]!;
        return texts.map(() => 0);
      },
    });

    await reranker.rerank('q', [hit('a.md', 0.5, 'x'.repeat(500))]);

    expect(seen).toHaveLength(10);
  });

  it('scores every candidate in batches no larger than batchSize', async () => {
    const batches: number[] = [];
    const reranker = createCrossEncoderReranker({
      batchSize: 2,
      score: async (_query, texts) => {
        batches.push(texts.length);
        return texts.map(() => 0);
      },
    });

    const out = await reranker.rerank(
      'q',
      Array.from({ length: 5 }, (_, i) => hit(`${i}.md`, 1 - i / 10)),
    );

    expect(batches).toEqual([2, 2, 1]);
    expect(out).toHaveLength(5);
  });

  it('propagates model failures so the pipeline can fall back', async () => {
    const reranker = createCrossEncoderReranker({
      score: async () => {
        throw new Error('onnx exploded');
      },
    });

    await expect(reranker.rerank('q', [hit('a.md', 0.5)])).rejects.toThrow('onnx exploded');
  });

  it('scores full chunk text rather than the query-aware snippet', async () => {
    // A snippet is a ~280-char excerpt deliberately chosen to contain query
    // terms, so every candidate's snippet looks relevant and the cross-encoder
    // loses the signal it needs. It must judge the real chunk text.
    let seen: string[] = [];
    const reranker = createCrossEncoderReranker({
      textSource: async (chunkIds) =>
        new Map(chunkIds.map((id) => [id, `full text of ${id}`])),
      score: async (_query, texts) => {
        seen = texts;
        return texts.map(() => 0);
      },
    });

    await reranker.rerank('q', [hit('a.md', 0.9, 'cherry-picked snippet')]);

    expect(seen).toEqual(['full text of a.md#0']);
  });

  it('falls back to the snippet when full text is unavailable', async () => {
    let seen: string[] = [];
    const reranker = createCrossEncoderReranker({
      textSource: async () => new Map(),
      score: async (_query, texts) => {
        seen = texts;
        return texts.map(() => 0);
      },
    });

    await reranker.rerank('q', [hit('a.md', 0.9, 'the snippet')]);

    expect(seen).toEqual(['the snippet']);
  });

  it('requests text only for the candidates it reranks', async () => {
    const requested: string[][] = [];
    const reranker = createCrossEncoderReranker({
      topN: 2,
      textSource: async (chunkIds) => {
        requested.push(chunkIds);
        return new Map();
      },
      score: async (_query, texts) => texts.map(() => 0),
    });

    await reranker.rerank('q', [
      hit('a.md', 0.9),
      hit('b.md', 0.8),
      hit('c.md', 0.7),
    ]);

    expect(requested).toEqual([['a.md#0', 'b.md#0']]);
  });

  it('identifies itself by model so traces distinguish rerankers', () => {
    const reranker = createCrossEncoderReranker({
      model: 'Xenova/bge-reranker-base',
      score: async (_query, texts) => texts.map(() => 0),
    });

    expect(reranker.id).toBe('cross-encoder:Xenova/bge-reranker-base');
  });
});
