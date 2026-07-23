import type { QueryInput, QueryPlan, QueryPlanner } from '../types.js';

export function createPassthroughQueryPlanner(): QueryPlanner {
  return {
    id: 'passthrough-v1',
    async plan(input: QueryInput): Promise<QueryPlan> {
      return passthroughQueryPlan(input);
    },
  };
}

export function passthroughQueryPlan(input: QueryInput): QueryPlan {
  return {
    original: input.query,
    lexical: [{ id: 'original', text: input.query, weight: 1 }],
    semantic: [{ id: 'original', text: input.query, weight: 1 }],
  };
}
