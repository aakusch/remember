import type { RememberConfig } from '../types.js';

/**
 * Type-safe config helper. Returns the input unchanged at runtime; the
 * value exists to give IDEs full autocomplete and type-checking when users
 * author their `remember.config.ts`.
 */
export function defineConfig(config: RememberConfig): RememberConfig {
  return config;
}
