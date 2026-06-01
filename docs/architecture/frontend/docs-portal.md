<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Docs Portal Architecture

> Public-facing user documentation served at `/docs` from authored markdown.
> Source feature: [`specs/001-public-docs-portal`](../../../specs/001-public-docs-portal). Tracking: LFXV2-2001.

## Goals

- **Publicly reachable.** No auth on `/docs/**`, `/sitemap.xml`, or `/robots.txt`. Indexable by crawlers and Intercom.
- **Authored in markdown.** Single source of truth: `index.md` files under `docs/user/<topic>/<slug>/`.
- **LFX-native styling.** Reading experience matches the rest of the product (Inter, brand blues, prose-lfx typography preset).
- **Discoverable.** Topic landing pages, full-text search, in-app docs icon, sitemap parity.
- **Bookmarkable.** Stable lowercase URLs, no query strings, never reshuffled by client routing.

## Build pipeline

The pipeline is plain Node.js, lives under [`apps/lfx-one/scripts/`](../../../apps/lfx-one/scripts/), and is chained directly into `start`, `build*`, `watch`, and `test` via `&&` in `apps/lfx-one/package.json`:

```text
docs/user/**/index.md
        │
        ▼  walk-source.mjs        (gray-matter front-matter, mtime capture)
        ▼  marked-config.mjs      (custom renderer: link rewrite + heading IDs)
        ▼  sanitize.mjs           (sanitize-html allowlist + external link rel)
        ▼  build-manifest.mjs     (DocsArticle / DocsTopic / DocsTaxonomyNode)
        ▼  build-search-index.mjs (MiniSearch index + entries map)
        ▼  build-sitemap.mjs      (lastmod from per-article mtimes)
        ▼  build-docs.mjs         (orchestrator + URL-shape assertion)
        │
        ├─▶ src/app/modules/docs/generated/docs-manifest.ts   (consumed by Angular at build)
        ├─▶ public/assets/docs/search-index.json              (lazy-loaded by DocsSearchService)
        └─▶ dist-docs/sitemap.xml                             (served by sitemap.route.ts)
```

The pipeline is **idempotent (R17)**: `generatedAt` derives from the maximum source `mtime`, never `Date.now()`. CI re-runs `docs:build` twice and SHA-256-compares the artifacts (`docs:check-idempotence`).

### CI gates

`docs:check` chains every gate; CI invokes the same script:

| Step        | Script                   | Enforces                                                                                              |
| ----------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| build       | `docs:build`             | URL shape `^/docs(?:/[a-z0-9-]+)*$` (US4 / FR-024)                                                    |
| validate    | `docs:validate`          | Manifest + search index conform to JSON Schemas in `specs/001-public-docs-portal/contracts/` (FR-031) |
| coverage    | `docs:check-coverage`    | Every `index.md` indexed; every leaf article ≤ 2 hops from `/docs` (FR-010, SC-010)                   |
| sitemap     | `docs:check-sitemap`     | Sitemap URLs ≡ manifest article URLs (SC-003a)                                                        |
| idempotence | `docs:check-idempotence` | Two consecutive builds produce byte-identical artifacts (R17)                                         |

## Routing

`/docs` is a sibling top-level route in [`app.routes.ts`](../../../apps/lfx-one/src/app/app.routes.ts), lazily loading `DocsLayoutComponent` and `DOCS_ROUTES`. It does **not** sit under the auth-guarded shell — that's deliberate.

```text
/docs                 → DocsLandingComponent
/docs/not-found       → DocsNotFoundComponent (HTTP 404 via app.routes.server.ts)
/docs/<slug...>       → DocsArticleComponent (resolved by docsArticleResolver)
```

The Express side carries matching `auth: 'public'` rules in [`auth.middleware.ts`](../../../apps/lfx-one/src/server/middleware/auth.middleware.ts) for `/docs`, `/sitemap.xml`, and `/robots.txt`, all registered before the catch-all so anonymous SSR works without a redirect to login.

### URL normalization contract (T045 / FR-024)

Manifest slugs are emitted **canonical** (lowercase kebab, no leading/trailing slash). [`docsArticleResolver`](../../../apps/lfx-one/src/app/modules/docs/resolvers/docs-article.resolver.ts) normalizes the request side identically — so `/docs/MEETINGS`, `/docs/meetings/`, and `/docs//meetings` all collapse to the same `getArticle('meetings')` call. The build asserts the URL shape; the resolver enforces the canonical form at runtime.

## Layout switching

`DocsLayoutComponent` is **auth-aware** (FR-014). It reads `UserService.authenticated()` and renders one of two left rails:

- **Authenticated** → existing `LensSwitcherComponent` (full app chrome including the new docs icon at LFXV2-2001).
- **Anonymous** → `DocsSidebarNavComponent` (LF logo, docs icon, "What's New" + sign-in CTAs that carry `returnTo=<current-url>`).

The main content area is identical in both states — only the rail swaps. This means a logged-in user reading docs gets the full lens switcher; an anonymous visitor gets a focused docs shell that converts via the sign-in button.

## Search

`DocsSearchService` (`providedIn: 'root'`) lazy-loads `/assets/docs/search-index.json` on the first call to `search()`. SSR-safe: the service short-circuits when not in the browser. The MiniSearch options at runtime mirror the build-time options exactly — drift between the two would silently degrade ranking quality:

| Field    | Boost |
| -------- | ----- |
| title    | 3     |
| headings | 2     |
| tags     | 2     |
| body     | 1     |

`DocsSearchComponent` debounces the input, owns keyboard navigation (`ArrowUp/Down/Enter/Esc`), and renders snippets that highlight match terms via the MiniSearch result metadata. The empty state surfaces a "no results" message — never an empty dropdown.

## Component map

| Path                                                                                                                               | Role                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [`app/layouts/docs-layout`](../../../apps/lfx-one/src/app/layouts/docs-layout)                                                     | Auth-aware shell                                     |
| [`modules/docs/pages/docs-landing`](../../../apps/lfx-one/src/app/modules/docs/pages/docs-landing)                                 | `/docs` topic-card grid + search                     |
| [`modules/docs/pages/docs-article`](../../../apps/lfx-one/src/app/modules/docs/pages/docs-article)                                 | `/docs/<slug>` article + breadcrumb + siblings + SEO |
| [`modules/docs/pages/docs-not-found`](../../../apps/lfx-one/src/app/modules/docs/pages/docs-not-found)                             | `/docs/not-found` (HTTP 404)                         |
| [`modules/docs/components/docs-search`](../../../apps/lfx-one/src/app/modules/docs/components/docs-search)                         | Reactive search input + listbox                      |
| [`modules/docs/components/docs-topic-card`](../../../apps/lfx-one/src/app/modules/docs/components/docs-topic-card)                 | Branded topic surface for the landing grid           |
| [`modules/docs/components/docs-sidebar-nav`](../../../apps/lfx-one/src/app/modules/docs/components/docs-sidebar-nav)               | Public minimal left rail                             |
| [`modules/docs/services/docs-manifest.service.ts`](../../../apps/lfx-one/src/app/modules/docs/services/docs-manifest.service.ts)   | Synchronous lookup over the generated manifest       |
| [`modules/docs/services/docs-search.service.ts`](../../../apps/lfx-one/src/app/modules/docs/services/docs-search.service.ts)       | Lazy MiniSearch loader + snippet helper              |
| [`modules/docs/resolvers/docs-article.resolver.ts`](../../../apps/lfx-one/src/app/modules/docs/resolvers/docs-article.resolver.ts) | Slug normalization + `/docs/not-found` fallback      |

## Contracts

- [`docs-manifest.schema.json`](../../../specs/001-public-docs-portal/contracts/docs-manifest.schema.json) — manifest shape (Draft 2020-12).
- [`search-index.schema.json`](../../../specs/001-public-docs-portal/contracts/search-index.schema.json) — search-index file shape.
- [`docs.interface.ts`](../../../packages/shared/src/interfaces/docs.interface.ts) — TypeScript mirror of the schemas, consumed by both the build script and the Angular runtime.
- [`docs.constant.ts`](../../../packages/shared/src/constants/docs.constant.ts) — `DOCS_ROUTE_PREFIX`, `DOCS_TAXONOMY_ORDER`.

## Adding content

1. Drop a new `index.md` under `docs/user/<topic>/<slug>/` (the `<topic>` directory must already exist; topics are deliberately curated).
2. Front-matter is optional. Title falls back to the first H1; description falls back to a body snippet (FR-028).
3. Run `yarn start` (or `yarn build`) — `yarn docs:build` is chained explicitly into `start`, `build`, `build:development`, `build:production`, `build:staging`, `watch`, and `test` via `&&`, so the manifest, search index, and sitemap regenerate before Angular compiles. There is no `predev` / `prebuild` hook (Yarn 4 under `turbo run` does not fire `pre*` lifecycle hooks). To regenerate just the docs artifacts without invoking Angular, run `yarn docs:build` directly.
4. Run `yarn docs:check` before pushing — fails loud on missing manifest entry, schema drift, sitemap drift, or non-deterministic output.

Removing or renaming a slug is a breaking change for bookmarks. The not-found page surfaces a topic recovery list to soften that — see `docs-not-found.component.html`.

## Related rules

- [`.claude/rules/styling.md`](../../../.claude/rules/styling.md) — brand color tokens.
- [`.claude/rules/ssr-safety.md`](../../../.claude/rules/ssr-safety.md) — `isPlatformBrowser` guard pattern (search service follows it).
- [`.claude/rules/component-organization.md`](../../../.claude/rules/component-organization.md) — signal initialization + DELETE → CREATE rule.
