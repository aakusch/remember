/**
 * Agent tool definitions — the single source of truth served both by the HTTP
 * API at `GET /v1/tools` and by the `remember tools` CLI command. Anthropic /
 * OpenAI-compatible `input_schema` shapes: paste straight into a tool-use call.
 *
 * Keep names, order, and schemas STABLE — agents wire against them.
 */
export interface AgentToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const AGENT_TOOL_DEFS: readonly AgentToolDef[] = [
  {
    name: 'search_wiki',
    description:
      'Search this local wiki using hybrid BM25 + vector search. Returns ranked chunks with path, title, snippet, and frontmatter. ' +
      'Honesty contract: a result means the corpus contains text that ranked for the query — NOT proof an answer exists; if the ' +
      'right document is not in the corpus you still get its closest matches. Treat results as candidates to read, not answers. ' +
      '`score` is a fused rank score, comparable only within a single result set, never a probability or a cross-query threshold.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The natural-language query' },
        intent: {
          type: 'string',
          description:
            'Accepted but INERT in the open-source engine (the planner is passthrough and the reranker is none, so intent does ' +
            'not affect results). Reserved for the Pro engine. Safe to omit.',
        },
        k: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_page',
    description: 'Fetch the full markdown of one wiki page by path.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the page relative to the content root (e.g. "ops/runbooks/deploys.md")',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_pages',
    description: 'List wiki pages, paginated.',
    input_schema: {
      type: 'object',
      properties: {
        cursor: { type: 'string', description: 'Opaque cursor from a previous list call' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
    },
  },
] as const;
