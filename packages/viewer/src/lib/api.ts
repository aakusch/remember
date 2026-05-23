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

export interface ApiStatus {
  index: { state: string; page_count: number; chunk_count: number; model: string; model_dim: number };
  version: string;
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
    return await fetchJson<ApiPage>(`/pages/${encodeURIComponent(path).replace(/%2F/g, '/')}`);
  } catch {
    return null;
  }
}

export async function listPages(): Promise<{ pages: Array<{ path: string; size: number; modified: string }>; total: number }> {
  return fetchJson('/pages?limit=200');
}

export async function search(query: string, k = 10): Promise<{ query: string; results: SearchHit[]; query_ms: number }> {
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

export { API_BASE };
