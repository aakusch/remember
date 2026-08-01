import { HONESTY_CONTRACT } from '../search/honesty.js';

/**
 * Agent tool definitions — the single source of truth served by the HTTP API at
 * `GET /v1/tools`, the `remember tools` CLI command, AND the `remember mcp` server
 * (which maps these to native MCP tools). Anthropic / OpenAI-compatible
 * `input_schema` shapes: paste straight into a tool-use call.
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
      'Search this local wiki using hybrid BM25 + vector search. Use when the user asks you to recall ' +
      'something ("remember when we…", "remember how we…"). Returns ranked pages with path, title, snippet, ' +
      'and frontmatter. ' +
      HONESTY_CONTRACT,
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
  {
    name: 'write_page',
    description:
      'Save a markdown page into the wiki and index it (immediately findable). Use when the user asks ' +
      'you to STAGE something ("we should remember this", "add this to the wiki"). Give it a clear title ' +
      'as an `# H1` and optional frontmatter. Over HTTP this maps to PUT /v1/pages/<path> with { body }.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Content-relative path ending in .md, e.g. "decisions/2026-08-pricing.md"' },
        body: { type: 'string', description: 'The full markdown content of the page' },
      },
      required: ['path', 'body'],
    },
  },
] as const;
