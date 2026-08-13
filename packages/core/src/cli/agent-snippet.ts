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
 *
 * It leads with MCP because that is the intended agent surface: a persistent stdio
 * process, no port, no credential. The CLI is the fallback for a harness without
 * MCP. It must NOT hand the agent the HTTP write path — an earlier version told the
 * agent to `PUT /v1/pages/<path>` "+ the admin token", which put the credential that
 * gates every write into a file the agent reads on every prompt, and advertised a
 * write authority the engine deliberately keeps off the default agent surface.
 * Staging goes through the filesystem, which is canonical anyway.
 */
export const AGENT_TRIGGER_SNIPPET = `## remember — the project knowledge base

This project has a **remember** wiki (a local, hybrid-search knowledge base). Treat the word **"remember"** used as the user's imperative to you as a cue to use it — in two directions:

**Recall (retrieve).** "remember when we decided X", "remember how we structure this doc", "do you remember our deploy process" → treat it as a **retrieval request**: call the \`search_wiki\` tool if this wiki is connected over MCP, otherwise run \`remember search "<their query>" --json\`. Ground your answer in the returned pages instead of guessing. \`get_page\` (or \`remember get <path>\`) reads one page in full.

**Stage (store).** "we should remember this", "remember this for later", "let's save this", "add this to the wiki" → **write it into the knowledge base**: create or update a markdown page under \`content/\` with a clear title and short frontmatter so it is findable later. The filesystem is the source of truth; the watcher picks the file up, or run \`remember index\`.

Do **not** fire on the word "remember" appearing incidentally — inside a document you're reading, a quote, code, or ordinary prose. The cue is the user directing *you* to recall or save, not the token showing up in content. When in doubt about context, don't fire.

A search result is ranked text for the query, not proof an answer exists — read the top pages before you rely on them.`;
