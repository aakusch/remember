import { startServer } from '../../api/start-server.js';
import { VERSION } from '../../version.js';
import { banner, header, keyValues, c } from '../format.js';

/**
 * `remember start` — start the production agent API (assumes the index is
 * already built). CLI + API only.
 */
export async function startCommand(): Promise<void> {
  const { url, indexedOnBoot } = await startServer({ rootDir: process.cwd(), indexIfEmpty: true });
  const out = process.stdout;

  out.write(`\n${banner(VERSION)}  ${c.dim('start')}\n`);
  if (indexedOnBoot) {
    // Why: `start` is the Docker CMD, and it used to serve an empty index in
    // silence — a fresh container answered every query with zero results until
    // someone thought to POST /v1/index. "Assumes the index is already built" is
    // a fair contract for a local run and a trap for a container, so an empty
    // index now builds itself once on boot. A populated index is left alone.
    out.write(`${c.dim('index was empty — built it on boot')}\n`);
  }
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
