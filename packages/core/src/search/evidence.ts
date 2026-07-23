import type {
  EvidenceAccessScope,
  EvidenceConflict,
  EvidencePackage,
  EvidencePassage,
  QueryInput,
  SearchResult,
} from '../types.js';

export interface EvidenceCandidate extends SearchResult {
  canonical_url?: string;
  revision?: string;
  retrievalScore?: number;
  rerankerScore?: number;
  access_scope?: EvidenceAccessScope;
}

export interface EvidencePackageOptions {
  tokenBudget: number;
  maxPassages?: number;
  corpusVersion?: string;
  /**
   * Optional authorization boundary supplied by the caller. This is applied
   * before selection so adjacent or externally supplied chunks cannot bypass
   * the candidate/access set.
   */
  allowedChunkIds?: Iterable<string>;
  conflicts?: Array<{
    id: string;
    chunkIds: string[];
    description: string;
  }>;
  gaps?: string[];
}

/**
 * Convert ranked, already-authorized candidates into a provider-neutral,
 * token-bounded evidence package. This function performs no retrieval and no
 * model call.
 */
export function createEvidencePackage(
  query: string | QueryInput,
  candidates: EvidenceCandidate[],
  options: EvidencePackageOptions,
): EvidencePackage {
  if (!Number.isInteger(options.tokenBudget) || options.tokenBudget < 0) {
    throw new Error('tokenBudget must be a non-negative integer');
  }
  const maxPassages = options.maxPassages ?? candidates.length;
  if (!Number.isInteger(maxPassages) || maxPassages < 0) {
    throw new Error('maxPassages must be a non-negative integer');
  }

  const allowed = options.allowedChunkIds
    ? new Set(options.allowedChunkIds)
    : null;
  const seenChunks = new Set<string>();
  const passages: EvidencePassage[] = [];
  let remaining = options.tokenBudget;

  for (const candidate of candidates) {
    if (passages.length >= maxPassages || remaining <= 0) break;
    if (allowed && !allowed.has(candidate.chunk_id)) continue;
    if (seenChunks.has(candidate.chunk_id)) continue;
    seenChunks.add(candidate.chunk_id);

    const boundedText = fitText(candidate.snippet, remaining);
    const estimatedTokens = estimateTokens(boundedText);
    if (!boundedText || estimatedTokens === 0 || estimatedTokens > remaining) break;

    passages.push({
      citation_id: `S${passages.length + 1}`,
      source_id: candidate.path,
      chunk_id: candidate.chunk_id,
      path: candidate.path,
      ...(candidate.canonical_url
        ? { canonical_url: candidate.canonical_url }
        : {}),
      ...(candidate.revision ? { revision: candidate.revision } : {}),
      heading_path: [...(candidate.heading_path ?? [])],
      text: boundedText,
      signals: {
        score: candidate.score,
        retrievers: [...candidate.retrievers],
        ...(candidate.retrievalScore !== undefined
          ? { retrieval_score: candidate.retrievalScore }
          : {}),
        ...(candidate.rerankerScore !== undefined
          ? { reranker_score: candidate.rerankerScore }
          : {}),
      },
      ...(candidate.access_scope
        ? { access_scope: { ...candidate.access_scope } }
        : {}),
      estimated_tokens: estimatedTokens,
    });
    remaining -= estimatedTokens;
  }

  const citationByChunk = new Map(
    passages.map((passage) => [passage.chunk_id, passage.citation_id] as const),
  );
  const conflicts: EvidenceConflict[] = (options.conflicts ?? [])
    .map((conflict) => ({
      id: conflict.id,
      passage_ids: Array.from(
        new Set(
          conflict.chunkIds
            .map((chunkId) => citationByChunk.get(chunkId))
            .filter((id): id is string => id !== undefined),
        ),
      ),
      description: conflict.description,
    }))
    .filter((conflict) => conflict.passage_ids.length > 1);

  const normalizedQuery =
    typeof query === 'string'
      ? { query: normalizeWhitespace(query) }
      : {
          query: normalizeWhitespace(query.query),
          ...(query.intent?.trim()
            ? { intent: normalizeWhitespace(query.intent) }
            : {}),
        };

  return {
    query: normalizedQuery,
    ...(options.corpusVersion
      ? { corpusVersion: options.corpusVersion }
      : {}),
    passages,
    conflicts,
    gaps: Array.from(
      new Set((options.gaps ?? []).map(normalizeWhitespace).filter(Boolean)),
    ),
    estimatedTokens: passages.reduce(
      (sum, passage) => sum + passage.estimated_tokens,
      0,
    ),
  };
}

export function estimateTokens(text: string): number {
  const normalized = normalizeWhitespace(text);
  return normalized ? Math.ceil(Array.from(normalized).length / 4) : 0;
}

function fitText(text: string, tokenBudget: number): string {
  const normalized = normalizeWhitespace(text);
  if (estimateTokens(normalized) <= tokenBudget) return normalized;
  const characterBudget = tokenBudget * 4;
  if (characterBudget <= 0) return '';
  const characters = Array.from(normalized);
  const truncated = characters
    .slice(0, Math.max(0, characterBudget - 1))
    .join('')
    .trimEnd();
  return truncated.length < normalized.length ? `${truncated.replace(/[.…]+$/, '')}…` : truncated;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
