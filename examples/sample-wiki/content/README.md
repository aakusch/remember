---
title: Welcome
tags: [welcome, getting-started]
---

# Welcome to your wiki

This is the landing page of your `remember` wiki — a local-first, AI-ready knowledge base.

This is the `README.md` at your wiki root — the conventional landing page. It's just another markdown file, indexed and searchable like the rest.

## What goes here

Anything you want your team — and your AI agents — to be able to find:

- Onboarding docs and runbooks
- Architecture decisions and design notes
- Meeting summaries
- Process documentation
- Internal references and glossaries

## How AI plugs in

Every markdown file in this folder is automatically indexed for semantic search. AI agents query your wiki via:

```bash
curl 'http://localhost:4320/v1/search?q=how+do+we+onboard+a+new+client&k=5'
```

For Claude / GPT / any tool-calling LLM, drop in the auto-generated tool definitions:

```bash
curl 'http://localhost:4320/v1/tools'
```

## Editing

Edit any markdown file in your editor of choice — Obsidian, VS Code, Cursor, vim. With `remember dev` running, save the file and `remember` reindexes it within a second, so your changes show up immediately in search results.

For folder operations (move, rename, delete), just move the files — the watcher keeps the search index in sync. Or drive the write/admin routes on the HTTP API when you need to script it.

## Next

- [Getting started](./getting-started.md)
- [Folder organization](./examples/folder-organization.md)
