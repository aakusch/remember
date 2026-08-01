/**
 * Machine-discoverable capabilities — the single discovery object an agent can
 * fetch to learn everything it needs to drive remember, without stitching
 * together `status`, `tools`, and `health`.
 *
 * Served identically by:
 *   • the CLI     — `remember capabilities [--json]`
 *   • the HTTP API — `GET /v1/capabilities`
 *
 * The JSON shape is a stable contract. Agents wire against it, so:
 *   • never rename or reorder top-level keys,
 *   • bump `json_schema_version` on any breaking change to the shape,
 *   • keep the endpoint/command catalogs in sync with what actually ships
 *     (a test asserts the command catalog matches the CLI's command list).
 */
import { VERSION } from './version.js';

/**
 * Bumped only when the *shape* of this object changes in a breaking way
 * (a removed/renamed key, a changed type). Additive fields don't bump it.
 */
export const JSON_SCHEMA_VERSION = 1;

export interface CapabilityEndpoint {
  method: string;
  path: string;
  summary: string;
}

export interface CapabilityCommand {
  name: string;
  args?: string;
  summary: string;
}

export interface Capabilities {
  /** Engine version — matches package.json / `/v1/health`. */
  version: string;
  engine: {
    name: string;
    edition: 'open-source';
    /** How retrieval is performed, at a glance. */
    search: string;
    license: string;
    /** Base path every HTTP endpoint below hangs off. */
    api_base: string;
    /** Default API port when unset (REMEMBER_API_PORT overrides). */
    default_port: number;
    /** Query planner in effect. `passthrough` = no query rewriting (Pro adds planning). */
    planner: 'passthrough';
    /** Reranker in effect. `none` = fused order is final (Pro adds a cross-encoder). */
    reranker: 'none';
    /**
     * What this edition can and can't do, so an agent written against a Pro
     * deployment can detect missing features instead of discovering them via 404s.
     */
    features: {
      /** Deterministic corpus-health sweep (`remember doctor` / GET /v1/doctor). */
      doctor: boolean;
      /** Browser viewer UI — Pro only. */
      viewer: boolean;
      /** Declared subwikis + scoped API keys — Pro only. */
      subwikis: boolean;
      scoped_keys: boolean;
      /** Ingestable formats. The OSS engine is markdown-only. */
      formats: string[];
    };
  };
  /** Configured embedding model + dimensions, or null if not resolvable. */
  embedder: { model: string; dim: number } | null;
  endpoints: CapabilityEndpoint[];
  commands: CapabilityCommand[];
  json_schema_version: number;
}

/** Stable catalog of the agent-facing HTTP endpoints. */
export const CAPABILITY_ENDPOINTS: readonly CapabilityEndpoint[] = [
  { method: 'GET', path: '/v1/health', summary: 'Liveness + version' },
  { method: 'GET', path: '/v1/capabilities', summary: 'This discovery object' },
  { method: 'GET', path: '/v1/openapi.json', summary: 'OpenAPI 3.1 spec' },
  { method: 'GET', path: '/v1/search', summary: 'Hybrid BM25 + vector search' },
  { method: 'GET', path: '/v1/pages', summary: 'List indexed pages' },
  { method: 'GET', path: '/v1/pages/{path}', summary: 'Fetch one page by path' },
  { method: 'GET', path: '/v1/status', summary: 'Index + embedding-model status' },
  { method: 'GET', path: '/v1/doctor', summary: 'Corpus-health sweep (deterministic, no-LLM)' },
  { method: 'GET', path: '/v1/tools', summary: 'Anthropic/OpenAI tool definitions' },
] as const;

/**
 * Stable catalog of the read/agent-facing CLI commands. Mirrors the richer
 * command list in `cli/index.ts`; a test guards against drift.
 */
export const CAPABILITY_COMMANDS: readonly CapabilityCommand[] = [
  { name: 'search', args: '"<query>"', summary: 'Hybrid search (--json for agents)' },
  { name: 'get', args: '<path>', summary: 'Print one page (--json)' },
  { name: 'list', summary: 'List indexed pages (--json)' },
  { name: 'status', summary: 'Index dashboard (--json)' },
  { name: 'doctor', summary: 'Corpus-health sweep (--json, --strict)' },
  { name: 'tools', summary: 'Agent tool definitions (--json)' },
  { name: 'capabilities', summary: 'This discovery object (--json)' },
] as const;

/**
 * Build the discovery object. `embedder` is passed in by the caller — the API
 * has a resolved embedder in its route context; the CLI resolves it from config.
 */
export function buildCapabilities(
  opts: { embedder?: { model: string; dim: number } | null } = {},
): Capabilities {
  return {
    version: VERSION,
    engine: {
      name: '@useremember/core',
      edition: 'open-source',
      search: 'hybrid-bm25-vector-rrf',
      license: 'MIT',
      api_base: '/v1',
      default_port: 4320,
      planner: 'passthrough',
      reranker: 'none',
      features: {
        doctor: true,
        viewer: false,
        subwikis: false,
        scoped_keys: false,
        formats: ['md'],
      },
    },
    embedder: opts.embedder ?? null,
    endpoints: CAPABILITY_ENDPOINTS.map((e) => ({ ...e })),
    commands: CAPABILITY_COMMANDS.map((c) => ({ ...c })),
    json_schema_version: JSON_SCHEMA_VERSION,
  };
}
