/**
 * The trigger snippet a user (or their agent) adds to a coding agent's instructions
 * (CLAUDE.md / AGENTS.md) so the agent automatically reaches for the remember wiki
 * whenever the user asks it to recall something. This is the "seamless agent
 * introduction" — a few lines that turn a plain "remember when we…" into a real
 * retrieval call instead of a guess.
 *
 * remember never writes this into the user's files. The setup wizard PRINTS it (copy
 * it in yourself), and the seeded remember.md carries it (point your agent at the
 * wiki and it can add it itself). Kept short (agents read it on every prompt) and
 * honest (a result is ranked text, not proof an answer exists).
 */
export const AGENT_TRIGGER_SNIPPET = `## remember — recall from the knowledge base

This project has a **remember** wiki (a local, hybrid-search knowledge base).

**Trigger: the word "remember" used as the user's imperative to you.** When the user directs you to recall something — e.g. "remember when we decided X", "remember how we structure this doc", "do you remember our deploy process" — treat it as a **retrieval request**: run \`remember search "<their query>" --json\` (or GET \`http://localhost:4320/v1/search?q=…\`) and ground your answer in the returned pages instead of guessing.

Do **not** fire on the word "remember" appearing incidentally — inside a document you're reading, a quote, code, or ordinary prose. The cue is the user asking *you* to recall, not the token showing up in content. When in doubt about context, don't fire.

A result is ranked text for the query, not proof an answer exists — read the top pages before you rely on them.`;
