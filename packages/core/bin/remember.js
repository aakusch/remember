#!/usr/bin/env node
import('../dist/cli/index.js')
  .then(({ run }) => run(process.argv.slice(2)))
  .catch((err) => {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
      process.stderr.write(
        'remember: build artifacts not found. Run `pnpm build` in @remember/core first.\n',
      );
    } else {
      process.stderr.write(`remember: ${err?.message ?? err}\n`);
    }
    process.exit(1);
  });
