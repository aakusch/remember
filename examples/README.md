# Examples

This directory ships two reference workspaces used by tests and demos.

## `sample-wiki/`

A 25-page knowledge base across `engineering/`, `ops/`, `product/`, and `people/`. Comprehensive frontmatter — `tags`, `owner`, `severity`, `status`, etc. — so the table view (`/admin/views`) has interesting data to work with.

It's also wired as a pnpm workspace package, so `@useremember/core` is symlinked. Run it directly:

```bash
cd examples/sample-wiki
node ../../packages/core/bin/remember.js start
```

This is what the contributor docs reference when they say "run the dev stack against the bundled sample."

## `sample-vault/`

A tiny mock Obsidian vault — 6 markdown files in `Daily Notes/` and `Concepts/` with proper `[[Wikilinks]]` between them. The Obsidian connector in `sample-wiki/remember.config.ts` is pointed at this vault, so booting `sample-wiki` automatically syncs these files into `sample-wiki/content/external/obsidian/` and indexes them.

You can use this to verify connector + indexer + search behavior end-to-end without needing a real Obsidian install.

## Adding your own example

Examples must be runnable workspaces — drop a `package.json` with `@useremember/core: workspace:*` and they get picked up by `pnpm-workspace.yaml`'s `examples/*` glob.

Suggested examples that don't exist yet (PRs welcome):

- `personal-blog/` — minimalist blog setup with branding tweaks
- `team-runbooks/` — runbook-focused config with stricter frontmatter conventions
- `research-notes/` — daily-notes-style with the date sort and search demo
