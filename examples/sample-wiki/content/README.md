---
title: Welcome
tags: [welcome, getting-started]
---

# Welcome to your wiki

This is the landing page of your `remember` wiki — a local-first, AI-ready knowledge base.

You're seeing this because the `viewer.landing` setting in `remember.config.ts` points here. Change that setting to any other markdown file to set a different landing page.

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

Edit any markdown file in your editor of choice — Obsidian, VS Code, Cursor, vim. Save the file and `remember` reindexes it within a second. Your changes show up immediately in the viewer and in search results.

For folder operations (move, rename, delete), use the [admin panel](http://localhost:4321/admin/index) — it keeps the search index in sync automatically.

## Next

- [Getting started](./getting-started.md)
- [Folder organization](./examples/folder-organization.md)
