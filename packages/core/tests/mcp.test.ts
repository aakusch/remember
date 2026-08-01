import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildRememberMcpServer } from '../src/cli/commands/mcp-cmd.js';
import { createSqliteVecStore, type SqliteVecStore } from '../src/stores/sqlite-vec.js';
import { createHashEmbedder } from '../src/embedders/hash.js';
import { createHybridSearchEngine } from '../src/search/hybrid.js';
import { createNoneReranker } from '../src/rerankers/none.js';
import { createIndexer } from '../src/indexer/index.js';
import { createFsWalker } from '../src/walkers/fs-walker.js';
import { createRemarkParser } from '../src/parsers/remark.js';
import { createSmartSplitChunker } from '../src/chunkers/smart-split.js';
import { COMMANDS } from '../src/cli/index.js';
import { AGENT_TOOL_DEFS } from '../src/api/tool-defs.js';

let tmp: string;
let store: SqliteVecStore;
let client: Client;

/** Full in-process MCP round-trip over an in-memory transport (hash embedder → no
 *  model download, no spawn). */
async function connect(contentRoot: string) {
  const embedder = createHashEmbedder(384);
  store = await createSqliteVecStore({ path: path.join(tmp, 'index.db'), dim: embedder.dim });
  const indexer = createIndexer({
    walker: createFsWalker({}),
    parser: createRemarkParser(),
    chunker: createSmartSplitChunker({ size: 900, overlap: 0.15 }),
    embedder,
    store,
  });
  await indexer.indexAll(contentRoot);
  const engine = createHybridSearchEngine(store, embedder, createNoneReranker());
  const server = buildRememberMcpServer({ engine, store, indexer, contentRoot });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
}

const textOf = (r: { content: unknown }) =>
  JSON.parse(((r.content as Array<{ type: string; text: string }>)[0]!).text);

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-mcp-'));
  const content = path.join(tmp, 'content');
  await fs.mkdir(content);
  await fs.writeFile(path.join(content, 'alpha.md'), '---\ntitle: Alpha\n---\n# Alpha\n\nAlpha body about deploys.');
  await connect(content);
});
afterEach(async () => {
  await client?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('remember mcp — in-process protocol', () => {
  it('lists exactly the shared tool set (matches AGENT_TOOL_DEFS)', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['get_page', 'list_pages', 'search_wiki', 'write_page']);
    // Same tools the HTTP /v1/tools surface advertises — no drift.
    expect(names).toEqual(AGENT_TOOL_DEFS.map((d) => d.name).sort());
  });

  it('search_wiki returns the projected result shape (title, no chunk_idx)', async () => {
    const r = await client.callTool({ name: 'search_wiki', arguments: { query: 'deploys' } });
    const out = textOf(r);
    expect(out.count).toBeGreaterThan(0);
    expect(out.results[0]).toHaveProperty('title');
    expect(out.results[0]).not.toHaveProperty('chunk_idx');
  });

  it('get_page returns markdown, and 404s a missing page as an error result', async () => {
    const ok = await client.callTool({ name: 'get_page', arguments: { path: 'alpha.md' } });
    expect(textOf(ok).body).toContain('# Alpha');
    const miss = await client.callTool({ name: 'get_page', arguments: { path: 'nope.md' } });
    expect(miss.isError).toBe(true);
  });

  it('write_page stages a note that is immediately searchable (the recall+stage loop)', async () => {
    const w = await client.callTool({
      name: 'write_page',
      arguments: { path: 'decisions/pricing.md', body: '# Pricing decision\n\nWe chose $15/mo.' },
    });
    expect(textOf(w).ok).toBe(true);
    const s = await client.callTool({ name: 'search_wiki', arguments: { query: 'pricing decision' } });
    expect(textOf(s).results.some((r: { path: string }) => r.path === 'decisions/pricing.md')).toBe(true);
  });

  it('rejects a traversal path in write_page', async () => {
    const r = await client.callTool({
      name: 'write_page',
      arguments: { path: '../escape.md', body: '# x' },
    });
    expect(r.isError).toBe(true);
  });

  it('is registered in the CLI command list', () => {
    expect(COMMANDS.find((c) => c.name === 'mcp')).toBeTruthy();
  });
});
