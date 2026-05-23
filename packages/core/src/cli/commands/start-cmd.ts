import { startServer } from '../../api/start-server.js';

export async function startCommand(): Promise<void> {
  const { url } = await startServer({ rootDir: process.cwd() });
  process.stdout.write(`remember start: API listening at ${url}\n`);
  process.stdout.write(`  Health:  ${url}/v1/health\n`);
  process.stdout.write(`  Search:  ${url}/v1/search?q=...\n`);
  process.stdout.write(`  Tools:   ${url}/v1/tools\n`);
  process.stdout.write(`\nPress Ctrl+C to stop.\n`);

  await new Promise<void>(() => {
    // Keep the process alive; the server is a long-running task.
  });
}
