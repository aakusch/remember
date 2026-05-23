---
title: Getting started
tags: [getting-started, onboarding]
---

# Getting started

A two-minute tour of your new wiki.

## 1. Open the admin

Visit [`http://localhost:4321/admin/setup`](http://localhost:4321/admin/setup) to run the first-time setup wizard. It walks you through:

- Confirming the content directory
- Picking an embedding model (default: a small local model — no API key needed)
- Setting a port (default: 4321 for viewer, 4320 for the API)
- Optionally setting an admin token if you want to expose admin routes beyond localhost

## 2. Add some content

Drop any `.md` file into the `content/` folder. Within a second, the file watcher picks it up, runs it through the indexing pipeline (parse → chunk → embed → store), and your new content is searchable.

The default ignore rules skip:

- `drafts/**` — work-in-progress content
- `_*/**` — folders prefixed with underscore (convention: "private" or "system")
- `node_modules/**`
- `.git/**`

You can extend these with a `.rememberignore` file at the wiki root.

## 3. Search it

From the browser:

- Use the search box at the top of every page in the viewer
- Or visit [`/search`](http://localhost:4321/search) directly

From the command line:

```bash
curl 'http://localhost:4320/v1/search?q=getting+started&k=3'
```

From an AI agent: see [How AI plugs in](./README.md#how-ai-plugs-in) on the landing page.

## 4. Edit content

Open any `.md` file in your editor of choice. `remember` keeps content as plain markdown files in a normal directory — there's no proprietary database for prose. Use whichever editor you already love.

Save → reindex → searchable. The viewer and API both react via Server-Sent Events.

## 5. Commit when ready

`remember` doesn't touch git on your behalf. After you've edited or rearranged content, run `git add` and `git commit` yourself when you're ready to checkpoint.
