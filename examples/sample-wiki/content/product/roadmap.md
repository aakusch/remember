---
title: Product roadmap
tags: [product, roadmap, planning]
owner: product
status: living-document
quarter: Q3-2026
---

# Product roadmap

What we're building this quarter and why. This is a living document — assume it changes; check the date stamp on the bottom.

## Now (in-progress)

### AI search across customer notes

**Status:** in beta with 12 design-partner customers.

We're shipping semantic search over customer-facing notes. Customers currently rely on keyword search and report "I know it's in there but I can't find it" as their #2 frustration (NPS verbatim analysis, Q1 2026).

The technical approach: hybrid BM25 + vector search with a small reranker, scoped to each tenant's data. We're using an open-source local embedding model so customers' content doesn't leave their environment.

**Owners:** AI team (Pat, Sam); UX (Robin); infra support (Devon)
**Launch target:** end of Q3

### Bulk import from competitors

**Status:** scoping. Discovery interviews ongoing.

We've identified five competitor formats that account for 80% of inbound customer migrations. Building a one-click importer for each.

**Owners:** Growth (Jordan); Engineering (Casey)
**Launch target:** Q4

## Next (committed for Q4)

- **Workspaces** — let admins partition data into separate spaces with their own permissions and members
- **Public sharing** — share a page or workspace via a public link (with optional password)
- **Mobile app v2** — current app is a wrapped web view; this is a real native iOS app first, Android follows

## Later (Q1-Q2 next year)

- AI summarization for long pages
- Custom fields on records (currently we have ~15 fields, customers want to define their own)
- SSO via Okta and Microsoft Entra

## Not now (explicit no's)

- **API v3** — v2 is still serving us well; ROI on a rewrite is negative
- **Marketplace** — needs ecosystem we don't have yet
- **Vertical-specific templates** — explored, no clear winner; we're staying horizontal

## How we prioritize

Roadmap commitments come out of three inputs:

1. **Customer interviews** — minimum 20 conversations per major area before committing
2. **Usage analytics** — what people actually do vs. say
3. **Sales feedback** — patterns from lost deals and renewal conversations

We bias toward "boring features that compound" over "novel features that wow."

## Related

- [User research process](./user-research-process.md)
- [Feature flags](./feature-flags.md)

*Updated: 2026-05-23 by Pat*
