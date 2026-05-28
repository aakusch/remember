import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { API_BASE, getPage, listPages, search, getStatus, deletePage } from '../src/lib/api.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('viewer api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('getPage URL-encodes each path segment but preserves slashes', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ path: 'ops/a b.md', frontmatter: {}, body: 'x', last_modified: 'now' }),
    );
    await getPage('ops/a b.md');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toBe(`${API_BASE}/pages/ops/a%20b.md`);
  });

  it('getPage returns null on a non-ok response instead of throwing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, false, 404));
    await expect(getPage('missing.md')).resolves.toBeNull();
  });

  it('listPages requests the paginated pages endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ pages: [], cursor: null, total: 0 }));
    const res = await listPages();
    expect(res.total).toBe(0);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${API_BASE}/pages?limit=200`);
  });

  it('search builds a query string with q and k', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ query: 'hello', results: [], query_ms: 1 }));
    await search('hello world', 5);
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url.startsWith(`${API_BASE}/search?`)).toBe(true);
    const qs = new URLSearchParams(url.split('?')[1]);
    expect(qs.get('q')).toBe('hello world');
    expect(qs.get('k')).toBe('5');
  });

  it('getStatus returns null when the request fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 500));
    await expect(getStatus()).resolves.toBeNull();
  });

  it('deletePage issues a DELETE with an encoded path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, removed_chunks: 2 }));
    const res = await deletePage('ops/old note.md');
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API_BASE}/pages/ops/old%20note.md`);
    expect((init as RequestInit).method).toBe('DELETE');
  });
});
