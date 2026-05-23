const API_BASE = import.meta.env.REMEMBER_API ?? 'http://127.0.0.1:4320/v1';

export interface ApiPage {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  last_modified: string;
}

export interface SearchHit {
  path: string;
  chunk_idx: number;
  snippet: string;
  frontmatter: Record<string, unknown>;
  score: number;
  retrievers: ('bm25' | 'vector')[];
  chunk_id: string;
}

export interface PageMeta {
  path: string;
  size: number;
  modified: string;
  title?: string | null;
  last_indexed?: string;
  frontmatter?: Record<string, unknown>;
}

export interface PagesResponse {
  pages: PageMeta[];
  cursor: string | null;
  total: number;
  filter?: Record<string, string>;
  sort?: string | null;
  q?: string | null;
}

export interface ApiStatus {
  index: {
    state: string;
    page_count: number;
    chunk_count: number;
    model: string;
    model_dim: number;
  };
  version: string;
}

export interface ApiConfig {
  config: {
    name?: string;
    description?: string;
    content: string;
    server: { host: string; port: number; apiPort: number; adminToken: string | null };
    viewer: { landing: string; showAdmin: boolean; breadcrumbs: boolean };
    schemaVersion: number;
  };
  config_path: string | null;
  config_root: string;
}

async function fetchJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${pathname}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${pathname} ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function getPage(path: string): Promise<ApiPage | null> {
  try {
    const encoded = path
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    return await fetchJson<ApiPage>(`/pages/${encoded}`);
  } catch {
    return null;
  }
}

export async function listPages(): Promise<PagesResponse> {
  return fetchJson('/pages?limit=200');
}

export async function queryPages(params: {
  filter?: Record<string, string>;
  sort?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<PagesResponse> {
  const qs = new URLSearchParams();
  if (params.filter) {
    for (const [k, v] of Object.entries(params.filter)) {
      if (k && v) qs.append(`filter[${k}]`, v);
    }
  }
  if (params.sort) qs.set('sort', params.sort);
  if (params.q) qs.set('q', params.q);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  return fetchJson(`/pages?${qs.toString()}`);
}

export async function listAttrs(): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/attrs`);
    if (!res.ok) return [];
    const body = (await res.json()) as { keys: string[] };
    return body.keys;
  } catch {
    return [];
  }
}

export async function search(
  query: string,
  k = 10,
): Promise<{ query: string; results: SearchHit[]; query_ms: number }> {
  const qs = new URLSearchParams({ q: query, k: String(k) });
  return fetchJson(`/search?${qs.toString()}`);
}

export async function getStatus(): Promise<ApiStatus | null> {
  try {
    return await fetchJson<ApiStatus>('/status');
  } catch {
    return null;
  }
}

export async function getConfig(): Promise<ApiConfig | null> {
  try {
    return await fetchJson<ApiConfig>('/config');
  } catch {
    return null;
  }
}

// Admin operations — proxied through Astro endpoints which then hit core's API.

export async function triggerReindex(
  mode: 'incremental' | 'full' = 'incremental',
): Promise<{ ok: boolean; files_indexed?: number; chunks_added?: number; duration_ms?: number; error?: unknown }> {
  const res = await fetch(`${API_BASE}/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  return (await res.json()) as ReturnType<typeof triggerReindex> extends Promise<infer T> ? T : never;
}

export async function deletePage(path: string): Promise<{ ok: boolean; removed_chunks?: number; error?: unknown }> {
  const encoded = path.split('/').map((s) => encodeURIComponent(s)).join('/');
  const res = await fetch(`${API_BASE}/pages/${encoded}`, { method: 'DELETE' });
  return (await res.json()) as ReturnType<typeof deletePage> extends Promise<infer T> ? T : never;
}

export async function movePage(from: string, to: string): Promise<{ ok: boolean; error?: unknown }> {
  const res = await fetch(`${API_BASE}/pages/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
  return (await res.json()) as ReturnType<typeof movePage> extends Promise<infer T> ? T : never;
}

export async function createFolder(p: string): Promise<{ ok: boolean; error?: unknown }> {
  const res = await fetch(`${API_BASE}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p }),
  });
  return (await res.json()) as ReturnType<typeof createFolder> extends Promise<infer T> ? T : never;
}

export async function deleteFolder(p: string, recursive = true): Promise<{ ok: boolean; error?: unknown }> {
  const encoded = p.split('/').map((s) => encodeURIComponent(s)).join('/');
  const qs = recursive ? '?recursive=true' : '';
  const res = await fetch(`${API_BASE}/folders/${encoded}${qs}`, { method: 'DELETE' });
  return (await res.json()) as ReturnType<typeof deleteFolder> extends Promise<infer T> ? T : never;
}

export async function renameFolder(from: string, to: string): Promise<{ ok: boolean; error?: unknown }> {
  const res = await fetch(`${API_BASE}/folders/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
  return (await res.json()) as ReturnType<typeof renameFolder> extends Promise<infer T> ? T : never;
}

export async function saveConfig(source: string): Promise<{
  ok: boolean;
  written_to?: string;
  backup_path?: string | null;
  restart_required?: boolean;
  hint?: string;
  error?: { code: string; message: string; hint?: string };
}> {
  const res = await fetch(`${API_BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  });
  return (await res.json()) as Awaited<ReturnType<typeof saveConfig>>;
}

export async function savePage(
  p: string,
  body: string,
): Promise<{ ok: boolean; indexed?: number; error?: { code: string; message: string } }> {
  const encoded = p.split('/').map((s) => encodeURIComponent(s)).join('/');
  const res = await fetch(`${API_BASE}/pages/${encoded}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  return (await res.json()) as Awaited<ReturnType<typeof savePage>>;
}

export async function getPageRaw(p: string): Promise<string | null> {
  try {
    const encoded = p.split('/').map((s) => encodeURIComponent(s)).join('/');
    const res = await fetch(`${API_BASE}/pages/${encoded}?format=text`);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export interface ConnectorStatusDTO {
  name: string;
  kind: string;
  target: string;
  configured: boolean;
  last_sync_at: string | null;
  last_result: {
    files_written?: number;
    files_unchanged?: number;
    files_deleted?: number;
    duration_ms?: number;
    notes?: string;
  } | null;
  last_error: string | null;
}

export async function listConnectors(): Promise<ConnectorStatusDTO[]> {
  try {
    const res = await fetch(`${API_BASE}/connectors`);
    if (!res.ok) return [];
    const body = (await res.json()) as { connectors: ConnectorStatusDTO[] };
    return body.connectors;
  } catch {
    return [];
  }
}

export async function syncConnector(name: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/connectors/${encodeURIComponent(name)}/sync`, {
    method: 'POST',
  });
  return await res.json();
}

export async function syncAllConnectors(): Promise<unknown> {
  const res = await fetch(`${API_BASE}/connectors/sync`, { method: 'POST' });
  return await res.json();
}

export { API_BASE };
