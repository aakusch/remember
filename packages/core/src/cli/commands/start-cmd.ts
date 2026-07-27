import { startServer } from '../../api/start-server.js';
import { VERSION } from '../../version.js';
import { banner, header, keyValues, c } from '../format.js';

/**
 * `remember start` — start the production agent API (assumes the index is
 * already built). CLI + API only.
 */
export async function startCommand(): Promise<void> {
  const { url } = await startServer({ rootDir: process.cwd() });
  const out = process.stdout;

  out.write(`\n${banner(VERSION)}  ${c.dim('start')}\n`);
  out.write(header('API + agent endpoints'));
  out.write(
    '\n' +
      keyValues([
        ['base', c.accent(url)],
        ['health', `${url}/v1/health`],
        ['search', `${url}/v1/search?q=…`],
        ['pages', `${url}/v1/pages`],
        ['tools', `${url}/v1/tools  ${c.dim('(agent tool defs)')}`],
      ]) +
      '\n',
  );
  out.write(`\n${c.dim('Press Ctrl+C to stop.')}\n`);

  await new Promise<void>(() => {
    // Keep the process alive; the server is a long-running task.
  });
}
