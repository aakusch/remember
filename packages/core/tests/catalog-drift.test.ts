import { describe, it, expect } from 'vitest';
import { CAPABILITY_ENDPOINTS } from '../src/capabilities.js';
import { openApiPaths } from '../src/api/routes.js';

// Guards the three endpoint catalogs from drifting apart (this is exactly how
// /v1/doctor ended up in /v1/capabilities + the router but NOT the OpenAPI spec).
describe('endpoint catalog consistency', () => {
  // These are meta endpoints intentionally absent from the OpenAPI path list.
  const META = new Set(['/v1/health', '/v1/capabilities', '/v1/openapi.json']);

  it('every advertised capability endpoint is in the OpenAPI spec (or is meta)', () => {
    const specPaths = new Set(Object.keys(openApiPaths)); // keys are un-prefixed, e.g. "/search"
    for (const e of CAPABILITY_ENDPOINTS) {
      if (META.has(e.path)) continue;
      const specKey = e.path.replace(/^\/v1/, '').replace(/\{(\w+)\}/g, '{$1}');
      expect(specPaths.has(specKey), `${e.path} → ${specKey} missing from openApiPaths`).toBe(true);
    }
  });

  it('/doctor is present in both the capability catalog and the OpenAPI spec', () => {
    expect(CAPABILITY_ENDPOINTS.some((e) => e.path === '/v1/doctor')).toBe(true);
    expect(Object.keys(openApiPaths)).toContain('/doctor');
  });
});
