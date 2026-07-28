---
title: Getting started
tags: [getting-started, onboarding]
---

# Getting started

A two-minute tour of your new wiki.

## 1. Index and serve

From the wiki root, index your content and start the agent API:

```bash
remember index          # parse → chunk → embed → store
remember start          # serve the search + agent API on http://localhost:4320
```

The first index downloads a small local embedding model (no API key needed),
then caches it. Set an admin token with `REMEMBER_ADMIN_TOKEN` if you want to
expose the write/admin routes beyond localhost.

## 2. Add some content

Drop any `.md` file into the `content/` folder. `remember dev` runs a file
watcher that picks it up within a second, runs it through the indexing pipeline
(parse → chunk → embed → store), and makes your new content searchable.

The default ignore rules skip:

- `drafts/**` — work-in-progress content
- `_*/**` — folders prefixed with underscore (convention: "private" or "system")
- `node_modules/**`
- `.git/**`

You can extend these with a `.rememberignore` file at the wiki root.

## 3. Search it

From the command line:

```bash
remember search "getting started" -k 3      # ranked result cards
remember search "getting started" --json    # machine-readable for agents
remember get getting-started.md             # read a full page
```

From the HTTP API:

```bash
curl 'http://localhost:4320/v1/search?q=getting+started&k=3'
```

From an AI agent: see [How AI plugs in](./README.md#how-ai-plugs-in) on the landing page.

## 4. Edit content

Open any `.md` file in your editor of choice. `remember` keeps content as plain
markdown files in a normal directory — there's no proprietary database for
prose. Use whichever editor you already love.

Save → reindex → searchable. With `remember dev` running, the API reacts to
changes via Server-Sent Events.

## 5. Commit when ready

`remember` doesn't touch git on your behalf. After you've edited or rearranged
content, run `git add` and `git commit` yourself when you're ready to checkpoint.
