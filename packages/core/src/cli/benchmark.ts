import { benchmarkCommand } from './commands/benchmark-cmd.js';

benchmarkCommand(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`remember benchmark: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
