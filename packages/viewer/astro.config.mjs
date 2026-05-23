import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: {
    port: Number(process.env.REMEMBER_PORT ?? 4321),
    host: process.env.REMEMBER_HOST ?? '127.0.0.1',
  },
  vite: {
    define: {
      'import.meta.env.REMEMBER_API':
        JSON.stringify(process.env.REMEMBER_API ?? 'http://127.0.0.1:4320/v1'),
    },
  },
});
