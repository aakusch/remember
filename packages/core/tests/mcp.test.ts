import { describe, it, expect } from 'vitest';
import { COMMANDS } from '../src/cli/index.js';

// The full stdio JSON-RPC protocol is verified manually (spawning the built CLI +
// a real embedder would download the model and flake in CI). These guard against
// the command silently unregistering or the module failing to load.
describe('remember mcp command', () => {
  it('is registered in the CLI command list', () => {
    const cmd = COMMANDS.find((c) => c.name === 'mcp');
    expect(cmd).toBeTruthy();
    expect(cmd!.help).toContain('mcpServers');
  });

  it('the command module loads and exports mcpCommand', async () => {
    const mod = await import('../src/cli/commands/mcp-cmd.js');
    expect(typeof mod.mcpCommand).toBe('function');
  });
});
