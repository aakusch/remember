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
      'Search this local wiki using hybrid BM25 + vector search. Returns ranked chunks with paths, snippets, and frontmatter.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The natural-language query' },
        intent: {
          type: 'string',
          description: 'Optional purpose used for planning and reranking, not corpus content',
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
