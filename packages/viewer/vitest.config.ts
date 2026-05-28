import { defineConfig } from 'vitest/config';

// Unit tests for the viewer's framework-agnostic lib helpers (tree builder,
// crumbs, toc, api client). Astro components themselves are not unit-tested
// here — these cover the pure logic the pages import.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
