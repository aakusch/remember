// Default adapter factories. Scaffold returns descriptor objects; the
// indexer/search runtime resolves these to concrete adapter instances
// during implementation.

export const walker = {
  chokidar(opts: { respectGitignore?: boolean; ignore?: string[] } = {}) {
    return { _kind: 'walker:chokidar', opts: { respectGitignore: true, ...opts } } as const;
  },
};

export const parser = {
  remark() {
    return { _kind: 'parser:remark' } as const;
  },
};

export const chunker = {
  smartSplit(opts: { size?: number; overlap?: number } = {}) {
    return {
      _kind: 'chunker:smartSplit',
      opts: { size: 900, overlap: 0.15, ...opts },
    } as const;
  },
};

export const embedder = {
  localOnnx(opts: { model?: string } = {}) {
    return {
      _kind: 'embedder:localOnnx',
      opts: { model: 'BAAI/bge-small-en-v1.5', ...opts },
    } as const;
  },
  openai(opts: { model?: string; apiKey?: string } = {}) {
    return {
      _kind: 'embedder:openai',
      opts: { model: 'text-embedding-3-small', ...opts },
    } as const;
  },
};

export const store = {
  sqliteVec(opts: { path?: string } = {}) {
    return {
      _kind: 'store:sqliteVec',
      opts: { path: '.remember/index.db', ...opts },
    } as const;
  },
};

export const search = {
  hybrid(
    opts: {
      bm25?: { enabled?: boolean; weight?: number };
      vector?: { enabled?: boolean; weight?: number };
      fusion?: 'rrf';
      rerank?: unknown;
      planner?: unknown;
      limits?: {
        perRetrieverK?: number;
        candidateK?: number;
        finalK?: number;
      };
      topK?: number;
      candidateK?: number;
      finalK?: number;
      rrfK?: number;
      pathBoostFactor?: number;
      headingBoostFactor?: number;
      dedupByPage?: boolean;
    } = {},
  ) {
    return {
      _kind: 'search:hybrid',
      opts: {
        bm25: { enabled: true, weight: 0.5 },
        vector: { enabled: true, weight: 0.5 },
        fusion: 'rrf' as const,
        limits: {
          perRetrieverK: 30,
          candidateK: 30,
          finalK: 10,
        },
        ...opts,
      },
    } as const;
  },
};

export const rerank = {
  none() {
    return { _kind: 'rerank:none' } as const;
  },
};

export const queryPlanner = {
  passthrough() {
    return { _kind: 'query-planner:passthrough' } as const;
  },
};

