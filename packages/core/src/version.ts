/**
 * Single source of truth for the core package version.
 *
 * Keep this in sync with packages/core/package.json "version". Every place that
 * reports a version — the CLI (`--version`, help banner), the HTTP API
 * (`/v1/health`, `/v1/status`, OpenAPI), and the benchmark metadata — imports
 * from here so a release bump touches exactly one line of code.
 */
export const VERSION = '0.2.0';
