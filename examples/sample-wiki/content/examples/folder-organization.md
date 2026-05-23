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

- **`README.md` in a folder** acts as the index for that folder (rendered when the viewer hits the folder URL)
- **kebab-case filenames** — for clean URLs and consistent search
- **frontmatter tags** — let AI agents filter (`GET /v1/pages?filter[tag]=runbook`)
- **prefix with `_`** for private/system folders that should never be indexed (e.g. `_templates/`, `_archive/`)
- **prefix with `drafts/`** for work-in-progress content that isn't ready for the index

## Restructuring later

Folders are not load-bearing. Use the admin panel to:

- **Move a page** between folders (drag-drop) → URL updates, search index updates, no manual sync
- **Rename a folder** → every nested page's URL updates automatically
- **Delete a folder** → recursive removal with confirmation; chunks deleted from the index

`remember` doesn't commit the changes to git for you — review with `git diff`, commit when satisfied.

## Naming the landing page

The viewer's `/` route renders whatever file you set in `remember.config.ts`:

```ts
viewer: {
  landing: 'README.md',     // any markdown file relative to the content root
}
```
