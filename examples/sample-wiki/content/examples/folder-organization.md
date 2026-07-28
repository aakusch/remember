---
title: Folder organization
tags: [structure, conventions]
---

# Folder organization

How to lay out content in your `remember` wiki.

## The basics

Folders become navigation. Filenames become URL slugs. Frontmatter becomes metadata. That's the whole structure.

```
content/
  README.md                   → /
  getting-started.md          → /getting-started
  ops/
    runbooks/
      deploys.md              → /ops/runbooks/deploys
    onboarding/
      new-engineer.md         → /ops/onboarding/new-engineer
  references/
    glossary.md               → /references/glossary
```

## Conventions

- **`README.md` in a folder** acts as the index for that folder (the conventional entry point when browsing or fetching a folder)
- **kebab-case filenames** — for clean URLs and consistent search
- **frontmatter tags** — let AI agents filter (`GET /v1/pages?filter[tag]=runbook`)
- **prefix with `_`** for private/system folders that should never be indexed (e.g. `_templates/`, `_archive/`)
- **prefix with `drafts/`** for work-in-progress content that isn't ready for the index

## Restructuring later

Folders are not load-bearing. With `remember dev` running, just move the files:

- **Move a page** between folders → the watcher reindexes; no manual sync
- **Rename a folder** → every nested page is reindexed under its new path
- **Delete a folder** → the removed files' chunks drop out of the index

`remember` doesn't commit the changes to git for you — review with `git diff`, commit when satisfied.

## The landing page

`README.md` at the content root is the conventional entry point — the first
page a human reads. It's an ordinary markdown file, indexed and searchable like
any other; rename or relink it however suits your wiki.
