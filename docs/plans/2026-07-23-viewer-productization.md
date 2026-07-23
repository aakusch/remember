# Viewer productization — consumer surface implementation plan

**Status:** Primed for future implementation
**Date:** 2026-07-23
**Owner:** Product + Design + Engineering
**Primary repository:** `remember`
**Primary package:** `packages/viewer` (`http://localhost:4321`)
**Sequence:** Begin foundation work near the end of retrieval Phase 1; complete
the consumer Search surface before broad Answer or connector expansion

## Goal

Turn the current browser viewer from a capable developer console into the
default human product surface for Remember:

> A person should be able to connect knowledge, understand whether it is
> ready, find useful evidence, inspect its source, and connect an agent without
> learning Remember's file layout, ports, index internals, or configuration
> schema.

This is a total information-architecture, interaction, component-system, copy,
responsive-layout, and workflow revision. It is not a color refresh and it
must not preserve every current control merely because the control already
exists.

Technical depth remains available through progressive disclosure. The default
experience serves a capable nontechnical user; advanced Search traces,
configuration, indexing controls, API details, and diagnostics remain
available to operators and developers when relevant.

## Product boundary

The viewer is the human control and inspection surface for Remember's search
and answer engine. It is not a general-purpose workspace, block editor,
project manager, or replacement for the systems where source knowledge is
authored.

Its primary jobs are:

1. get a source connected and indexed;
2. show whether the knowledge system is ready and current;
3. search or ask and receive useful, source-cited evidence;
4. inspect the underlying source and retrieval details;
5. fix a source, sync, permission, or indexing problem;
6. connect a human's preferred agent to the same knowledge; and
7. expose advanced configuration without requiring it for normal use.

The viewer may retain lightweight page reading and editing where those
capabilities make the retrieval product more useful. It must not expand into a
broad authoring suite.

## Audience and distribution reality

The first productized target is a person who can install or open Remember but
should not have to edit TypeScript, use `curl`, understand vector dimensions,
or operate a database.

Polishing `localhost:4321` alone does not make the entire product
consumer-ready. Before positioning Remember for a general nontechnical
audience, make a separate distribution decision:

- a signed local application or launcher that owns the background service and
  opens the viewer;
- a managed Cloud workspace that serves the same product surface; or
- a deliberately narrower prosumer product with an installer or one-command
  setup.

Until that decision is implemented, call the viewer a simplified local product
surface, not a zero-setup consumer application.

## Priming audit

### Method

The 2026-07-23 sweep reviewed the live bundled sample workspace at desktop
`1440 × 1000` and mobile `390 × 844`, including:

- home and page reading;
- Search with results and filters;
- workspace administration;
- setup;
- files and structural operations;
- table view;
- connectors;
- reindexing;
- configuration;
- diagnostics; and
- the component, layout, API, and inline-script source.

The audit used the real 25-page sample corpus. It did not rely only on static
source inspection.

### What is already useful

Preserve these product strengths while revising their presentation:

- local-first light/dark support;
- immediate access to a searchable page tree;
- source paths and metadata on results;
- inspectable retrieval provenance;
- an operational view of connector and index state;
- server-rendered pages that remain useful with little client JavaScript;
- edit/history and structural operations for local content;
- frontmatter filtering and table inspection for advanced users; and
- a clean API boundary between the viewer and core.

### Current friction

#### App shell and navigation

- Two permanent left rails consume approximately 460 pixels before content.
- `Home`, `Search`, `Admin`, a global search box, recent-page tabs, workspace
  controls, and page navigation compete without a clear task hierarchy.
- `Admin` is an implementation boundary, not a user goal.
- The workspace dashboard leads with maintenance surfaces instead of readiness,
  search, sources, or next actions.
- Recent-page tabs add another navigation model without proving a recurring
  user need.

#### Mobile and narrow layouts

- At `390px`, the fixed header, admin rail, and page tree remain side by side.
- The primary content is pushed beyond the viewport and cannot be used.
- Navigation labels and the search input overflow.
- Desktop collapse controls are not a mobile navigation solution.

Responsive repair is a release blocker, not a final polish task.

#### Search

- Search is the strongest product surface but is visually and conceptually
  separated from the rest of the workspace.
- The highlighted `Answer` is currently an extracted passage, not a generated,
  validated Answer. The label overstates the behavior.
- Raw retriever names and uncalibrated scores are prominent while source
  usefulness, freshness, and why a result matters are under-explained.
- Snippets concatenate headings, checklist syntax, and paragraph text.
- Facets are presented as a long technical rail even when most users need only
  one or two contextual filters.
- Empty, partial, unanswerable, and fallback states need intentional designs.

#### Setup and configuration

- Setup is a long configuration form organized around engine internals.
- Presets such as model size, host, port, dimensions, and API configuration
  appear before the user has completed the basic job of connecting knowledge.
- Configuration paths and restart instructions assume command-line fluency.
- The UI does not provide a short readiness checklist or explain the next
  highest-value action.

#### Sources and connectors

- Connectors are configured in `remember.config.ts`, then merely observed in
  the UI.
- Raw constructor errors are shown directly to the user.
- A failed source does not provide a guided repair action.
- Source freshness, permission scope, indexed item count, and last successful
  sync are not assembled into one understandable source-health model.

#### Library and structural operations

- The page tree is useful for browsing, but it is permanently visible even
  when it is irrelevant to the current task.
- Files exposes repeated destructive buttons at row level with little context.
- Table view requires comma-separated column names and raw key/value filters.
- Page metadata, freshness, source ownership, and indexed state are split
  across multiple surfaces.

#### Operations and technical depth

- Reindex, diagnostics, loaded configuration, model information, logs, and API
  details are useful, but they are promoted to primary navigation.
- Index operations use engine language rather than explaining the user-visible
  outcome.
- Technical errors are not translated into a plain-language summary, likely
  cause, and safe next action.

#### Component and styling foundation

The viewer has the beginning of semantic color tokens, but not a reusable
product component system:

- `Layout.astro` is 735 lines and owns tokens, shell layout, utility classes,
  navigation, and four separate behavior scripts;
- the viewer contains 17 component/page style blocks;
- 97 inline `style` declarations bypass consistent variants and responsive
  behavior;
- large route files combine data loading, product logic, markup, styling, and
  client behavior (`setup.astro` is 691 lines and `search.astro` is 488);
- buttons, fields, cards, tables, statuses, errors, dialogs, and empty states
  are restyled per page; and
- icon definitions and interaction behavior are duplicated or embedded in
  route code.

Adding more screens on this foundation will make consistency and accessibility
harder. Standardization precedes broad feature expansion.

## Product principles for the revision

1. **Lead with the user's outcome.** Say “Update searchable knowledge,” not
   “Run incremental reindex,” until the advanced detail is requested.
2. **Search is the center of gravity.** Home, sources, and library exist to make
   Search and future Answers more useful and trustworthy.
3. **Simple by default, deep by inspection.** Do not remove technical power;
   place it behind a relevant disclosure, inspector, or Advanced section.
4. **One component, one meaning.** A status badge, destructive action, source
   card, or form field behaves the same everywhere.
5. **Every element earns its placement.** A component is present because it
   advances the current task, communicates consequential state, or exposes a
   likely next action.
6. **Progressive disclosure is contextual.** Prefer “View retrieval details”
   on a result over a global “expert mode” that makes every screen dense.
7. **Failures are actionable.** Show what happened, what remains usable, and
   the safest next step. Keep raw details copyable in an expanded section.
8. **Destructive actions are scarce and recoverable.** Separate frequent safe
   actions from delete/restore operations. Prefer trash or undo where the
   storage model permits it.
9. **Responsive behavior is designed, not collapsed desktop.** Narrow layouts
   preserve the primary task and move secondary navigation into drawers or
   contextual sheets.
10. **Do not fake intelligence.** Only call a response an Answer when it uses
    the shipped Answer contract, validated citations, and abstention behavior.

## Proposed information architecture

### Primary navigation

Use a single workspace navigation model:

1. **Home** — readiness, primary Search/Ask entry, recent useful activity, and
   next actions;
2. **Search** — evidence retrieval and future cited Answers;
3. **Library** — pages, collections, metadata, and lightweight content
   operations;
4. **Sources** — connections, sync, freshness, permissions, and repair; and
5. **Settings** — workspace preferences, Search behavior, agents/API, and
   Advanced operations.

Do not expose a top-level `Admin` concept. Authorization may still protect
administrative actions, but navigation labels describe jobs.

### Home

Home should answer four questions in order:

1. What can I ask?
2. Is my knowledge ready and current?
3. What should I do next?
4. What recently changed or needs attention?

Recommended composition:

- one prominent Search/Ask input;
- a compact readiness summary;
- source health and last sync;
- a single prioritized setup or repair action;
- recent or suggested searches only when backed by real behavior; and
- a quiet link to agent connection.

Do not make a raw Markdown landing page the only default dashboard. Keep a
separate configurable “Overview page” or library landing when users want one.

### Search

The default result experience should contain:

- one stable query field;
- a clear mode selector only when multiple shipped modes exist;
- a plain-language result summary;
- source title, useful passage, path/location, freshness, and source type;
- compact contextual filters;
- visible citations that open the source;
- a useful empty or insufficient-evidence state; and
- a result-level “Why this result?” or retrieval-details disclosure for
  advanced users.

Raw scores, retriever provenance, query variations, stage timing, corpus
version, and fallback reason belong in the details disclosure or an inspector.
They remain copyable and complete.

Until generated Answers ship, rename the current extracted passage to
`Best matching passage` or remove the special card when it duplicates result
one.

### Library

Combine the useful parts of Pages, Files, and Table view:

- browsable hierarchy and searchable list;
- list/table display modes;
- human-readable filters with discovered values;
- saved views only after recurring demand is observed;
- page metadata, source, freshness, and indexing state;
- preview/open as the primary row action;
- edit or rename as contextual actions; and
- destructive actions in an overflow menu with explicit confirmation.

Comma-separated column configuration remains available in Advanced or through
an API, not as the default table builder.

### Sources

Each source should show:

- recognizable source type and name;
- connected, syncing, needs attention, paused, or disconnected state;
- last successful sync and freshness;
- indexed items and meaningful changes;
- access scope when known;
- one primary action appropriate to its state; and
- a plain-language issue with guided repair.

Connection setup should be a UI workflow for supported connectors. Raw config
examples remain available under Advanced setup and documentation.

### Settings and advanced operations

Organize settings by user intent:

- **General:** name, appearance, default landing behavior;
- **Search:** default retrieval mode and result behavior;
- **Agents & API:** connection instructions, keys, MCP/API examples;
- **Sources:** defaults and sync policy when not handled on a source card;
- **Data & safety:** export, backups, history, destructive operations; and
- **Advanced:** model/provider configuration, index controls, diagnostics,
  raw loaded config, logs, ports, and developer metadata.

Advanced does not mean neglected. It uses the same components, hierarchy,
plain-language summaries, and responsive behavior as the default product.

## Component-system plan

### Decision gate

Before implementation, record a short architecture decision covering:

- continued Astro components versus introducing an interactive island
  framework;
- the accessible primitive library, if any;
- icon source;
- form validation and toast/dialog behavior;
- component tests and visual regression tooling; and
- the relationship between local viewer components and Cloud UI components.

Do not migrate frameworks solely to obtain a visual style. Prefer established,
accessible primitives compatible with the selected rendering model and wrap
them in Remember-owned semantic components.

### Foundations

Extract:

- semantic color, typography, spacing, radius, elevation, motion, and layer
  tokens;
- light and dark themes with equivalent hierarchy and contrast;
- content widths and responsive breakpoints;
- focus, disabled, loading, selected, success, warning, and danger states; and
- icon size and stroke conventions.

Tokens describe roles such as `surface`, `text-muted`, `action-primary`, and
`status-danger`; components must not depend on page-specific hard-coded
colors.

### Required primitives

Build and document, at minimum:

- `AppShell`, `WorkspaceNav`, `MobileNav`, and `PageHeader`;
- `Button`, `IconButton`, and `ButtonGroup`;
- `Input`, `SearchInput`, `Select`, `Textarea`, `Checkbox`, and `FormField`;
- `Card`, `Section`, `Separator`, and `Disclosure`;
- `Badge`, `StatusBadge`, and `Metadata`;
- `Alert`, `InlineNotice`, `EmptyState`, `Skeleton`, and `Progress`;
- `Dialog`, `ConfirmDialog`, `Drawer`, `DropdownMenu`, and `Toast`;
- `DataTable`, `FilterBar`, and `Pagination`;
- `SourceCard`, `SearchResult`, `Citation`, and `RetrievalDetails`; and
- `CodeBlock` and `CopyButton` for advanced/API content.

Each primitive needs:

- named variants rather than page-specific class combinations;
- keyboard and screen-reader behavior;
- light, dark, narrow, loading, empty, error, and disabled states where
  applicable;
- a small component-gallery route or test fixture; and
- usage rules explaining when not to use it.

### Migration rule

Do not combine a full visual redesign and behavior rewrite across every route
in one unreviewable change. Establish foundations and the new shell, migrate
one complete user journey, then remove superseded styles and components as
each vertical slice is accepted.

No new route-specific button, card, field, alert, status pill, or dialog style
may be added after the corresponding shared primitive exists.

## Responsive layout contract

### Wide desktop

- one primary navigation rail;
- library tree or filters appear only when relevant;
- optional inspector uses a contextual right panel or drawer;
- content remains the visually dominant region.

### Tablet and narrow desktop

- primary navigation collapses to an icon rail or drawer;
- contextual library/filter panels are independently toggleable;
- tables select essential columns and allow deliberate horizontal inspection
  when unavoidable.

### Mobile

- one compact header with workspace identity and navigation trigger;
- Search remains immediately reachable;
- no permanent side rail;
- filters and retrieval details open in sheets;
- primary actions remain visible without horizontal scrolling;
- touch targets are at least 44 CSS pixels; and
- dense operational tables become cards, summaries, or explicitly scrollable
  regions.

Validate at `320`, `390`, `768`, `1024`, and `1440` CSS-pixel widths. A page
with no horizontal overflow at one width is not sufficient evidence.

## Implementation workstreams

### Workstream 0 — Contracts, inventory, and measurements

- inventory every route, action, state, API dependency, and authorization
  requirement;
- mark each current element keep, combine, move, replace, or remove;
- define primary journeys and baseline completion time/error observations;
- stabilize Phase 1 Search, trace, evidence, freshness, and source-health
  contracts before binding the new UI to them; and
- decide local/Cloud component and route sharing boundaries.

**Gate:** approved information architecture, component decision, state
inventory, and test plan.

### Workstream 1 — Foundations and app shell

- extract tokens and shared primitives;
- implement the single navigation model;
- implement responsive desktop, tablet, and mobile shells;
- replace top navigation, dual rails, and recent tabs;
- preserve direct URLs and useful collapsed state only where still relevant;
- create consistent page headers, actions, notices, and loading states; and
- add automated accessibility and screenshot coverage.

**Gate:** shell and primitive gallery pass keyboard, contrast, responsive, and
theme checks before feature migration.

### Workstream 2 — Onboarding and Home

- replace engine-first setup with a short outcome-based flow;
- guide the user through workspace identity, first source, indexing readiness,
  first Search, and optional agent connection;
- defer provider, port, model, and schema details to Advanced;
- create the readiness-oriented Home surface;
- translate startup and configuration failures into guided recovery; and
- preserve raw configuration preview/export for technical users.

**Gate:** a new user can reach a successful Search using a supported setup path
without editing a config file or reading API documentation.

### Workstream 3 — Search and evidence experience

- rebuild Search on the Phase 1 response contract;
- correct snippet segmentation and hierarchy;
- move raw scoring and timing into retrieval details;
- implement compact, contextual filters;
- design exact, semantic, ambiguous, empty, insufficient, fallback, and error
  states;
- expose citations and source inspection consistently; and
- remove the misleading pre-Answer `Answer` label.

**Gate:** representative users find and open the expected evidence, understand
its source, and can inspect advanced retrieval details without those details
obscuring the default experience.

### Workstream 4 — Library and Sources

- consolidate page tree, files, and table view around one Library model;
- make metadata and filter selection human-readable;
- move destructive actions out of the primary row;
- add recovery or undo where feasible;
- build guided connection and repair flows for supported sources; and
- standardize freshness and source health.

**Gate:** a user can locate content, understand where it came from, connect or
repair a supported source, and safely perform common content operations.

### Workstream 5 — Technical depth and operations

- reorganize Setup, Configuration, Reindex, Diagnostics, logs, history, and
  agent/API details under relevant Settings sections;
- keep complete trace and raw error information copyable;
- distinguish safe routine maintenance from expensive or destructive work;
- add confirmation summaries and post-action outcomes;
- document every advanced control in place; and
- avoid requiring a terminal for supported configuration.

**Gate:** technical users retain the current operational power while default
navigation and workflows remain understandable to nontechnical users.

### Workstream 6 — Hardening and product validation

- complete keyboard-only and screen-reader journeys;
- verify light, dark, reduced-motion, zoom, and high-content-density states;
- add end-to-end tests for primary journeys and failure recovery;
- establish visual regression coverage at required widths;
- test with empty, small, large, stale, partially failing, and unauthorized
  workspaces;
- measure server-render and interaction performance; and
- run observed usability sessions before calling the viewer productized.

## Primary validation journeys

Automate the deterministic portion and observe real users completing:

1. open a new workspace and understand its state;
2. connect or select the first supported source;
3. wait for indexing and know when it is ready;
4. search for a known fact and open the cited source;
5. recognize when evidence is insufficient;
6. repair a failed source sync;
7. find a page and inspect its metadata;
8. connect an agent using guided instructions;
9. inspect why an advanced Search result ranked; and
10. safely update the index or restore content.

## Success and exit gates

The phase is complete only when:

- all primary journeys work without direct config editing for supported paths;
- the default UI does not require knowledge of ports, model dimensions,
  retriever names, database adapters, or config schema;
- technical users can still inspect trace, config, API, index, and diagnostic
  detail;
- no primary route horizontally overflows at required viewport widths;
- keyboard navigation, focus management, labels, announcements, and contrast
  pass the selected accessibility test suite;
- Search result hierarchy clearly distinguishes retrieved evidence from a
  generated Answer;
- destructive actions identify the target, explain impact, and require an
  intentional confirmation;
- raw connector and engine errors are translated and remain available under
  details;
- shared components replace route-local implementations for the required
  primitive set;
- full build, typecheck, unit, component, integration, and end-to-end suites
  pass; and
- at least five representative users complete first-source and first-Search
  journeys without coaching, with observed confusion documented and resolved
  or explicitly accepted.

## Explicitly deferred

- a broad block editor;
- real-time multiplayer authoring;
- project/task management;
- decorative dashboards without a decision or action;
- a permanent global expert-mode toggle;
- hiding technical detail that is required for trust or operation;
- a framework rewrite without an accepted architecture decision;
- connector breadth before the supported connection flow is usable;
- generated Answer UI before citation validation and abstention ship; and
- claiming general-consumer readiness before installation and service
  lifecycle are productized.

## Relationship to retrieval and Answer phases

Late Workstream 0 and Workstream 1 may overlap retrieval Phase 1 because tokens,
components, responsive layout, and workflow research do not depend on ranking
behavior.

Workstream 3 must integrate the stable Phase 1 Search, trace, and evidence
contracts rather than inventing viewer-only response shapes.

Complete the core consumer Search journey before broad Answer preview. Answer
UI then extends the established `SearchResult`, `Citation`,
`RetrievalDetails`, insufficient-evidence, budget, and fallback components
instead of creating a second product surface.
