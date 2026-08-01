/**
 * The honesty contract — the single canonical wording. CLAUDE.md requires this be
 * consistent across every agent-facing surface (the `search_wiki` tool description
 * served over HTTP `/v1/tools`, the `remember tools` CLI, the MCP server, and the
 * README). Import this rather than re-typing it, so the surfaces can't drift.
 */
export const HONESTY_CONTRACT =
  'A result means the corpus contains text that ranked for the query — NOT proof an answer exists; ' +
  'if the right document is not in the corpus you still get its closest matches. Treat results as ' +
  'candidates to read, not answers. `score` is a fused rank score, comparable only within a single ' +
  'result set, never a probability or a cross-query threshold.';
