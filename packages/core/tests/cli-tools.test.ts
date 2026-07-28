import { describe, it, expect } from 'vitest';
import { AGENT_TOOL_DEFS } from '../src/api/tool-defs.js';
import { parseToolsArgs } from '../src/cli/commands/tools-cmd.js';

describe('agent tool defs (remember tools / GET /v1/tools)', () => {
  it('exposes a stable name set and order', () => {
    // Agents wire against these names/order — lock them.
    expect(AGENT_TOOL_DEFS.map((t) => t.name)).toEqual([
      'search_wiki',
      'get_page',
      'list_pages',
    ]);
  });

  it('each def is Anthropic/OpenAI-shaped', () => {
    for (const t of AGENT_TOOL_DEFS) {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(t.input_schema.type).toBe('object');
      expect(typeof t.input_schema.properties).toBe('object');
    }
  });

  it('search_wiki requires query and caps k at 50', () => {
    const search = AGENT_TOOL_DEFS.find((t) => t.name === 'search_wiki')!;
    expect(search.input_schema.required).toEqual(['query']);
    const k = search.input_schema.properties.k as { maximum: number; default: number };
    expect(k.maximum).toBe(50);
    expect(k.default).toBe(10);
  });

  it('get_page requires path', () => {
    const get = AGENT_TOOL_DEFS.find((t) => t.name === 'get_page')!;
    expect(get.input_schema.required).toEqual(['path']);
  });
});

describe('parseToolsArgs', () => {
  it('defaults json to false', () => {
    expect(parseToolsArgs([])).toEqual({ json: false });
  });
  it('accepts --json', () => {
    expect(parseToolsArgs(['--json'])).toEqual({ json: true });
  });
  it('rejects unknown flags', () => {
    expect(() => parseToolsArgs(['--nope'])).toThrow(/unknown flag/);
  });
});
