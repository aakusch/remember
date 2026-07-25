import type { RerankedResult, Reranker, SearchResult } from '../types.js';

export interface CrossEncoderRerankerOptions {
  /** Cross-encoder sequence-classification model with ONNX weights. */
  model?: string;
  /** Rerank at most this many candidates; the tail keeps its retrieval order. */
  topN?: number;
  /** Pairs per forward pass. */
  batchSize?: number;
  /** Candidate text is truncated to this many characters before scoring. */
  maxTextLength?: number;
  /**
   * Scoring backend. Injectable so ranking behavior can be tested without
   * downloading a model, and so alternative backends can be swapped in.
   */
  score?: (query: string, texts: string[]) => Promise<number[]>;
  /**
   * Resolves full chunk text by chunk id.
   *
   * Required for good ranking: `SearchResult.snippet` is a ~280-character
   * excerpt that `extractSnippet` deliberately centers on the query terms, so
   * every candidate's snippet looks query-relevant and the cross-encoder has
   * almost nothing to discriminate on. Scoring snippets measurably *hurt*
   * ranking on beir-fiqa (recall@5 .413 -> .283). Falls back to the snippet
   * when text is unavailable.
   */
  textSource?: (chunkIds: string[]) => Promise<Map<string, string>>;
}

const DEFAULT_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';

/**
 * Cross-encoder reranker. Unlike the retrieval stage, which scores the query
 * and document independently, this scores them jointly and is therefore far
 * better at judging whether a candidate actually answers the query.
 *
 * It exists because the candidate set already contains the right document more
 * often than the final ranking surfaces it: on the beir-fiqa fixture candidate
 * recall is .600 while recall@10 is .490, and top-1 is wrong 71.7% of the time.
 * Closing that gap is a ranking problem, not a retrieval problem.
 */
export function createCrossEncoderReranker(
  opts: CrossEncoderRerankerOptions = {},
): Reranker {
  const modelId = opts.model ?? DEFAULT_MODEL;
  const topN = opts.topN ?? 20;
  const batchSize = opts.batchSize ?? 16;
  const maxTextLength = opts.maxTextLength ?? 1200;
  const score = opts.score ?? createLocalCrossEncoderScorer(modelId);

  return {
    id: `cross-encoder:${modelId}`,
    async rerank(query, candidates) {
      if (candidates.length === 0) return [];

      const head = candidates.slice(0, topN);
      const tail = candidates.slice(topN);

      const texts = opts.textSource
        ? await opts.textSource(head.map((candidate) => candidate.chunk_id))
        : undefined;

      const logits: number[] = [];
      for (let start = 0; start < head.length; start += batchSize) {
        const batch = head.slice(start, start + batchSize);
        logits.push(
          ...(await score(
            query,
            batch.map((c) => candidateText(c, maxTextLength, texts)),
          )),
        );
      }

      const reranked: RerankedResult[] = head.map((candidate, index) => {
        const logit = logits[index] ?? 0;
        // Raw logits are unbounded, which makes a poor public score. Sigmoid
        // maps them to (0,1) so they stay comparable to retrieval scores.
        const finalScore = sigmoid(logit);
        return {
          ...candidate,
          score: finalScore,
          retrievalScore: candidate.score,
          rerankerScore: logit,
          finalScore,
        };
      });

      // Sort by index on ties so equal model scores preserve retrieval order
      // instead of depending on sort implementation details.
      const order = reranked.map((result, index) => ({ result, index }));
      order.sort((a, b) => b.result.finalScore - a.result.finalScore || a.index - b.index);

      return [...order.map((entry) => entry.result), ...tail];
    },
  };
}

function candidateText(
  candidate: SearchResult,
  maxTextLength: number,
  texts?: Map<string, string>,
): string {
  const full = texts?.get(candidate.chunk_id);
  return (full ?? candidate.snippet).slice(0, maxTextLength);
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

/**
 * Lazily loads a local ONNX cross-encoder through @huggingface/transformers,
 * mirroring the local embedder: the optional dependency is only required if
 * this reranker is actually used.
 */
function createLocalCrossEncoderScorer(
  modelId: string,
): (query: string, texts: string[]) => Promise<number[]> {
  let modelPromise: Promise<{
    tokenize: (query: string, texts: string[]) => unknown;
    forward: (inputs: unknown) => Promise<number[]>;
  }> | null = null;

  async function load() {
    if (!modelPromise) {
      modelPromise = (async () => {
        let transformers: typeof import('@huggingface/transformers');
        try {
          transformers = await import('@huggingface/transformers');
        } catch (err) {
          throw new Error(
            `CrossEncoderReranker requires the optional dependency "@huggingface/transformers". Install it with: pnpm add @huggingface/transformers (filter @useremember/core). Underlying error: ${(err as Error).message}`,
          );
        }
        const tokenizer = await transformers.AutoTokenizer.from_pretrained(modelId);
        const model = await transformers.AutoModelForSequenceClassification.from_pretrained(
          modelId,
          { dtype: 'fp32' },
        );
        return {
          tokenize: (query: string, texts: string[]) =>
            (tokenizer as unknown as (
              input: string[],
              options: { text_pair: string[]; padding: boolean; truncation: boolean },
            ) => unknown)(new Array(texts.length).fill(query), {
              text_pair: texts,
              padding: true,
              truncation: true,
            }),
          forward: async (inputs: unknown) => {
            const output = (await (model as unknown as (i: unknown) => Promise<unknown>)(
              inputs,
            )) as { logits: { tolist: () => number[][] } };
            // Single-logit models emit a relevance score directly; two-class
            // models put "relevant" in the second position.
            return output.logits
              .tolist()
              .map((row) => (row.length === 1 ? (row[0] ?? 0) : (row[1] ?? 0)));
          },
        };
      })();
    }
    return modelPromise;
  }

  return async (query, texts) => {
    if (texts.length === 0) return [];
    const model = await load();
    return model.forward(model.tokenize(query, texts));
  };
}
