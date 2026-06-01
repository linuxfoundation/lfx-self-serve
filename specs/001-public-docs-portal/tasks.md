---
description: 'Task list for Public-Facing User Documentation Portal'
---

# Tasks: Public-Facing User Documentation Portal

**Input**: Design documents from `specs/001-public-docs-portal/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The spec did not explicitly request TDD, but the plan named four Playwright E2E specs as concrete deliverables (`public-access.spec.ts`, `search.spec.ts`, `shell-auth-states.spec.ts`, `sitemap.spec.ts`). Those are included as story-scoped tasks below — implementation order within a story is flexible (tests can be written first, alongside, or last; pre-PR they all need to pass).

**Organization**: Tasks are grouped by user story (US1–US6 from spec.md) so each story can be implemented and demoed independently. US1 is the MVP boundary.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks).
- **[Story]**: Maps a task to a user story (US1, US2, …). Setup, Foundational, and Polish phases have no story label.
- Each task description ends with the exact file path it touches.

## Path conventions (from plan.md)

This is the LFX Self Serve Turborepo monorepo. Concrete locations:

- Angular SSR app: `apps/lfx-one/`
- Shared types/constants: `packages/shared/`
- Source markdown (canonical, untouched): `docs/user/`
- New build script: `apps/lfx-one/scripts/`
- Generated artifacts (gitignored): `apps/lfx-one/src/app/modules/docs/generated/` and `apps/lfx-one/dist-docs/`
- Playwright E2E: `apps/lfx-one/e2e/docs/`
- Spec contracts (validation source): `specs/001-public-docs-portal/contracts/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, dependency installation, configuration scaffolding.

- [x] T001 Add docs-pipeline runtime/build dependencies (`gray-matter`, `minisearch`, `sanitize-html`, `@tailwindcss/typography`) and their `@types/*` siblings where applicable to `apps/lfx-one/package.json`; run `yarn install` to refresh `yarn.lock`.
- [x] T002 [P] Add `@tailwindcss/typography` to the plugin list in `apps/lfx-one/tailwind.config.js` and register a stub `prose-lfx` typography preset (final brand-token mapping happens in T049).
- [x] T003 [P] Add npm scripts `docs:build`, `docs:validate`, `docs:check-coverage`, `docs:check-sitemap`, plus `prebuild` and `predev` hooks that invoke `docs:build`, in `apps/lfx-one/package.json`.
- [x] T004 [P] Add `apps/lfx-one/src/app/modules/docs/generated/` and `apps/lfx-one/dist-docs/` to `apps/lfx-one/.gitignore` (or root `.gitignore` if that is where Angular generated paths are tracked).
- [x] T005 [P] Create empty directory scaffolding: `apps/lfx-one/scripts/`, `apps/lfx-one/scripts/lib/`, `apps/lfx-one/src/app/layouts/docs-layout/`, `apps/lfx-one/src/app/modules/docs/{pages,components,services,generated}/`, `apps/lfx-one/e2e/docs/`. (Add a single `.gitkeep` per empty directory only if the repo's gitignore would otherwise drop them.)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build pipeline, shared types, route registration, layout shell — must be in place before ANY user story phase begins. No user-visible behavior yet; this phase exists so US1–US6 can each run end-to-end as soon as their phase completes.

**CRITICAL**: No user story work begins until this phase is complete.

### Shared types and constants

- [x] T006 [P] Add `DocsArticle`, `DocsHeading`, `DocsBreadcrumbItem`, `DocsTopic`, `DocsTaxonomyNode`, `DocsManifest`, `DocsSearchEntry`, `DocsSearchIndexFile`, and `DocsAudience` interfaces to `packages/shared/src/interfaces/docs.interface.ts` per [data-model.md](./data-model.md) §1–§5; export them via `packages/shared/src/interfaces/index.ts` (or whatever the package's barrel pattern is).
- [x] T007 [P] Add `DOCS_ROUTE_PREFIX = '/docs'` and `DOCS_TAXONOMY_ORDER` (canonical topic display order: badges, committees, dashboards, documents, events, mailing-lists, meetings, profile, settings, surveys, trainings, transactions, votes) to `packages/shared/src/constants/docs.constant.ts`; export from the constants barrel.

### Build pipeline (`apps/lfx-one/scripts/build-docs.mjs` and helpers)

- [x] T008 [P] Implement front-matter parsing and source-file walk in `apps/lfx-one/scripts/lib/walk-source.mjs` — uses `gray-matter` to walk `docs/user/`, returns `{ sourcePath, slug, frontMatter, body }` records, skipping the VitePress-only `docs/user/index.md` per research R8.
- [x] T009 [P] Implement the `marked` configuration with the cross-link rewriter renderer override in `apps/lfx-one/scripts/lib/marked-config.mjs` per research R3 + R11 (relative path resolution against the article's `sourcePath`, anchor-only links left as-is, absolute and `mailto:` links untouched, trailing `/index.md` stripped).
- [x] T010 [P] Implement HTML sanitization in `apps/lfx-one/scripts/lib/sanitize.mjs` — wraps `sanitize-html` with the LFX allowlist from research R4 (block elements, inline elements, `a` and `img` attributes, `rel="noopener noreferrer" target="_blank"` post-process for external links).
- [x] T011 Implement manifest assembly in `apps/lfx-one/scripts/lib/build-manifest.mjs` — consumes the records from T008, runs them through T009 and T010, derives `headings`, `bodyText`, `breadcrumb`, `siblings`, `isTopicLanding`, computes `contentHash` (SHA-256), and emits the in-memory `DocsManifest` shape per [data-model.md](./data-model.md) §4. **Front-matter fallback (FR-028)**: when `title` is missing, use the article's first H1 from `headings`; when `description` is missing, derive a ~160-character snippet from the first non-heading paragraph of `bodyText`. Missing front-matter MUST NOT fail the build — every article remains renderable via fallbacks. Depends on T008, T009, T010.
- [x] T012 [P] Implement search-index build in `apps/lfx-one/scripts/lib/build-search-index.mjs` — produces `DocsSearchEntry[]`, configures MiniSearch with field boosts (title 3x, headings 2x, tags 2x, body 1x) per research R5, calls `MiniSearch.toJSON()`, and wraps in the `DocsSearchIndexFile` envelope per [data-model.md](./data-model.md) §5. Depends on T011 (in-memory manifest provides article inventory).
- [x] T013 [P] Implement sitemap build in `apps/lfx-one/scripts/lib/build-sitemap.mjs` — emits `urlset` per [contracts/sitemap.example.xml](./contracts/sitemap.example.xml), one `<url>` entry per article, `<lastmod>` from `lastUpdated`. Depends on T011.
- [x] T014 Implement the top-level orchestrator at `apps/lfx-one/scripts/build-docs.mjs` — wires together T008–T013, writes `apps/lfx-one/src/app/modules/docs/generated/docs-manifest.ts` (TypeScript module with typed `export const docsManifest: DocsManifest = {…}`), `apps/lfx-one/src/app/modules/docs/generated/search-index.json`, and `apps/lfx-one/dist-docs/sitemap.xml`. Idempotent: re-running on the same input produces byte-identical outputs (research R17). Depends on T011, T012, T013.

### Server-side public route registration

- [x] T015 Add `{ pattern: '/docs', type: 'ssr', auth: 'public' }` to `DEFAULT_ROUTE_CONFIG` in `apps/lfx-one/src/server/middleware/auth.middleware.ts` BEFORE the catch-all `/` row, per research R7 (first-match-wins on `startsWith`).
- [x] T016 [P] Implement the sitemap route handler at `apps/lfx-one/src/server/routes/sitemap.route.ts` — reads `apps/lfx-one/dist-docs/sitemap.xml` at server startup, caches in memory, serves at `/sitemap.xml` with `Content-Type: application/xml; charset=utf-8` per research R9.
- [x] T017 Register the sitemap route in `apps/lfx-one/src/server/server.ts` (or wherever Express routes are wired) — confirm it sits BEFORE the Angular SSR catch-all so `/sitemap.xml` is not consumed by the Angular handler. Depends on T016.

### Angular routing and shell

- [x] T018 [P] Create `DocsLayoutComponent` skeleton at `apps/lfx-one/src/app/layouts/docs-layout/docs-layout.component.{ts,html,scss}` — auth-aware shell wrapper that hosts `<router-outlet>` in the central content area; wires up `UserService.isAuthenticated()` signal but defers the auth-state branching to US2 (T037, T038).
- [x] T019 [P] Implement `DocsManifestService` at `apps/lfx-one/src/app/modules/docs/services/docs-manifest.service.ts` — synchronous `getManifest()` / `getArticle(slug)` / `getTaxonomy()` / `getTopics()` per [data-model.md](./data-model.md) §7. Imports the generated `docs-manifest.ts` module from `apps/lfx-one/src/app/modules/docs/generated/`. SSR-safe (no browser-only API references).
- [x] T020 Add the `/docs` and `/docs/:catchAll(.*)` routes as siblings of the authGuard'd root in `apps/lfx-one/src/app/app.routes.ts`, both pointing at `DocsLayoutComponent` with child routes that lazy-load `DocsModule.routes` from `apps/lfx-one/src/app/modules/docs/docs.routes.ts`. Depends on T018.
- [x] T021 Create the docs feature's child route table at `apps/lfx-one/src/app/modules/docs/docs.routes.ts` — defines `''` → `DocsLandingComponent`, `'**'` → `DocsArticleComponent` (with a route resolver that maps the URL fragment to a slug, returns the article from `DocsManifestService`, and falls back to `DocsNotFoundComponent` on miss).
- [x] T021a [P] Implement `apps/lfx-one/scripts/check-sitemap.mjs` — parses `apps/lfx-one/dist-docs/sitemap.xml` and asserts the URL set equals the URL set computed from `docsManifest.articles` (SC-003a). Wired to the `docs:check-sitemap` npm script (T003). Lives in Foundational (rather than Phase 8 / US6) so the MVP cut after Phase 3 / US1 can run it as an automated CI gate, not just a manual sanity check. Depends on T014.

**Checkpoint**: Foundation ready — US1 implementation can begin.

---

## Phase 3: User Story 1 — Public visitor reads articles without signing in (Priority: P1) — MVP

**Goal**: An unauthenticated visitor can land on `https://<host>/docs/<topic>/<slug>` (deep link from Slack, Jira, Intercom, Google search) and immediately see a fully-rendered, brand-styled article — no login wall, no JS-required blank page, internal links navigate within `/docs/*`, and the URL inventory is discoverable via `sitemap.xml` referenced from `robots.txt`.

**Independent test**: Open an incognito browser, visit a deep `/docs/<topic>/<slug>` URL directly (no traversal from the landing page), confirm the article renders fully and view-source shows the body HTML without JavaScript hydration. Click an internal cross-link, confirm SPA navigation. Visit `/sitemap.xml` and `/robots.txt` from the same incognito session, confirm both return 200, the sitemap lists every article, and `robots.txt` references it.

### E2E test for US1

- [x] T022 [P] [US1] Add `apps/lfx-one/e2e/docs/public-access.spec.ts` covering US1 acceptance scenarios 1–5: anonymous deep link renders, view-source contains article HTML, internal cross-link navigates, broken `/docs/<missing>` shows 404 with link back to `/docs`, `/sitemap.xml` and `/robots.txt` are reachable without auth. Also asserts FR-024 indexability negatively: `<meta name="robots" content*="noindex">` MUST NOT be present and HTTP responses MUST NOT include an `X-Robots-Tag: noindex` header.

### Implementation for US1

- [x] T023 [P] [US1] Implement `DocsArticleComponent` at `apps/lfx-one/src/app/modules/docs/pages/docs-article/docs-article.component.{ts,html,scss}` — receives the `DocsArticle` from the route resolver, renders the `bodyHtml` field via `[innerHTML]` inside a `prose-lfx` container (per research R12), wires `Title` and `Meta` services in `ngOnInit` for title, description, OG, and Twitter card tags (FR-013, FR-023; research R10), sets a `<link rel="canonical">` in the document head pointing at the configured production origin + the article URL.
- [x] T024 [P] [US1] Implement `DocsLandingComponent` at `apps/lfx-one/src/app/modules/docs/pages/docs-landing/docs-landing.component.{ts,html,scss}` — pulls topics via `DocsManifestService.getTopics()`, renders a topic-card grid; the page IGNORES the VitePress `layout: home` / `hero:` / `features:` block in `docs/user/index.md` (research R8); sets page title and description via `Title`/`Meta`. The search-component slot is a passive placeholder until US3 plugs in `<lfx-docs-search>` (T044).
- [x] T025 [P] [US1] Implement `DocsNotFoundComponent` at `apps/lfx-one/src/app/modules/docs/pages/docs-not-found/docs-not-found.component.{ts,html,scss}` — renders a brand-consistent 404 message per FR-014 / Edge Case 4 with a primary link back to `/docs`. Sets HTTP status to 404 server-side (Angular SSR `provideServerRendering` + an HTTP status meta directive — pattern documented inline if no precedent exists in the app).
- [x] T026 [P] [US1] Implement `DocsTopicCardComponent` at `apps/lfx-one/src/app/modules/docs/components/docs-topic-card/docs-topic-card.component.{ts,html,scss}` — presentational card consumed by `DocsLandingComponent`; surfaces topic title, description, article count, link to the topic landing article.
- [x] T027 [US1] Wire the article route resolver implemented in T021: confirm the catch-all path is normalized (trim leading/trailing slashes), looked up via `DocsManifestService.getArticle()`, returns the article data on hit, redirects to `DocsNotFoundComponent` on miss. Update `apps/lfx-one/src/app/modules/docs/docs.routes.ts` if needed. Depends on T021, T023, T025.
- [x] T028 [US1] Implement the intra-content click interceptor in `DocsArticleComponent` per research R16 — `HostListener('click')` catches anchor clicks whose `href` begins with `/docs/`, calls `Router.navigateByUrl(href)`, and `event.preventDefault()`s; external links (different host) and non-`/docs/*` anchors fall through to default browser handling. Anchor-only (`#section`) links also fall through.
- [x] T029 [US1] [P] Add `apps/lfx-one/public/robots.txt` per [contracts/robots.example.txt](./contracts/robots.example.txt) — `User-agent: *` allow-all, with the production Sitemap URL hard-coded as `Sitemap: https://app.lfx.dev/sitemap.xml`. The file is hand-edited and committed (no build-time substitution); Angular's static-asset pipeline serves `apps/lfx-one/public/robots.txt` verbatim at `/robots.txt`, so no Express route is required. Non-production environments (preview, staging) are not exposed to public crawlers — the same production Sitemap URL is acceptable across all environments (matches the launch decision documented in [contracts/robots.example.txt](./contracts/robots.example.txt)). If per-environment flexibility is needed later, replace the committed file with a server-route handler analogous to the sitemap.xml pattern (T016/T017).
- [x] T030 [US1] Confirm the sitemap route from T016/T017 returns the build-emitted `dist-docs/sitemap.xml` and that the URLs it lists exactly match every entry in the `docsManifest.articles` map (manual sanity check on the MVP cut; automated parity check is T021a). Depends on T014, T016, T017, T021a.

**Checkpoint**: US1 complete — MVP shippable. An unauthenticated visitor can hit any `/docs/<topic>/<slug>`, the article renders, internal navigation works, broken URLs 404 cleanly, and `/sitemap.xml` + `/robots.txt` are crawlable.

---

## Phase 4: User Story 2 — Signed-in user discovers in-app help (Priority: P2)

**Goal**: A signed-in user sees a documentation icon in the small left navigation directly above the existing "What's new" (`fa-bullhorn`) button. Clicking it routes to `/docs` inside the existing app shell — lens switcher, avatar, header all preserved (FR-009a). An unauthenticated visitor at the same URL sees the public minimal shell — docs icon, "What's new", and a sign-in entry point only — with no lens switcher (FR-009b). Returning to a non-docs route restores the user's prior context (FR-009c).

**Independent test**: Sign in, click the new docs icon — `/docs` opens with the full app chrome including the lens switcher; navigate back to a non-docs route, confirm the user's prior context (active lens, scroll position) is preserved. Then open `/docs/<topic>/<slug>` in an incognito window — confirm the public minimal shell renders (docs icon present, lens switcher absent, sign-in entry point visible). Toggle between the two contexts via sign-in / sign-out.

### E2E test for US2

- [x] T031 [P] [US2] Add `apps/lfx-one/e2e/docs/shell-auth-states.spec.ts` covering all four US2 acceptance scenarios plus FR-009a/b/c: signed-in shell preservation, public shell composition, session round-trip, and the shell switch when authentication state flips.

### Implementation for US2

- [x] T032 [US2] Add the documentation icon button to the lens-switcher / small-left-nav template at `apps/lfx-one/src/app/shared/components/lens-switcher/lens-switcher.component.html` (or whichever component renders the icon-only left nav per the codebase reconnaissance — confirm the exact path during implementation), positioned directly above the `fa-bullhorn` "What's new" item. Icon: `fa-book` or equivalent FA-Pro icon already used by the app. Active state when current URL matches `/docs/*`. ARIA label "Documentation" per FR-026.
- [x] T033 [P] [US2] Implement `DocsSidebarNavComponent` (public minimal small left nav) at `apps/lfx-one/src/app/modules/docs/components/docs-sidebar-nav/docs-sidebar-nav.component.{ts,html,scss}` — renders the docs icon (active when `/docs/*`), the "What's new" icon, and a sign-in entry point that links to the existing `/login` handler with `?returnTo=<current /docs URL>`. No lens switcher, no avatar.
- [x] T034 [US2] Update `DocsLayoutComponent` (created in T018) to branch on `UserService.isAuthenticated()`: when truthy, mount the existing app chrome (the same components rendered by `MainLayoutComponent` minus its `<router-outlet>` host) wrapping the docs `<router-outlet>`; when falsy, mount `DocsSidebarNavComponent` and a brand-consistent minimal header. Implementation should reuse existing layout chrome components rather than duplicate markup. Depends on T032, T033.
- [x] T035 [US2] Verify and document session preservation: a signed-in user navigates `/dashboard` → `/docs/<x>` → `/dashboard` and the destination dashboard still has the user's prior lens and scroll position (or whatever state survival the existing layout already provides). If the app shell already preserves state via Angular's reuse strategy, no code change is required — this task captures the verification step in `apps/lfx-one/e2e/docs/shell-auth-states.spec.ts` (extending T031).

**Checkpoint**: US2 complete. The docs icon is present in both the authenticated and unauthenticated small left nav, and the shell auto-selects based on auth state without changing the URL.

---

## Phase 5: User Story 3 — Visitor searches the documentation (Priority: P2)

**Goal**: A visitor (signed-in or not) types a query into a single search box on `/docs` and any article page; matching pages — ranked by title, headings, and body relevance — appear with snippets and direct links, with no server round-trips after the initial index download.

**Independent test**: With the dev server running, open `/docs` in a fresh browser, type a unique phrase that appears once in the corpus, confirm exactly one result with a snippet, click it, land on the article. Repeat with a no-match query, confirm the empty-state UX. DevTools Network tab shows ONE request for `search-index.json` on the first search (lazy-loaded) and zero subsequent requests.

### E2E test for US3

- [x] T036 [P] [US3] Add `apps/lfx-one/e2e/docs/search.spec.ts` covering all three US3 acceptance scenarios: unique-phrase match, no-match empty state, and (a network-mocked or DevTools-asserted) verification that the search index is fetched once and cached.

### Implementation for US3

- [x] T037 [US3] Implement `DocsSearchService` at `apps/lfx-one/src/app/modules/docs/services/docs-search.service.ts` per [data-model.md](./data-model.md) §8 — lazy-loads `search-index.json` via `HttpClient` (or `fetch`) on the first `search()` call, calls `MiniSearch.loadJSON()`, caches the instance for the session, and exposes `search(query: string): SearchResult[]` returning ranked results with snippet generation per FR-018. SSR-safe (no-op or `[]` return when called server-side; client-only execution gated by `isPlatformBrowser`).
- [x] T038 [P] [US3] Implement `DocsSearchComponent` at `apps/lfx-one/src/app/modules/docs/components/docs-search/docs-search.component.{ts,html,scss}` — input field + dropdown/panel of results with title, breadcrumb, and snippet; debounced search (200 ms) per FR-016; keyboard navigation (arrow keys, Enter to select, Esc to close) per FR-026; visible focus rings; `aria-expanded`, `aria-controls`, `role="listbox"` per FR-027. Calls `DocsSearchService.search()`. Depends on T037.
- [x] T039 [US3] Embed `<lfx-docs-search>` in `DocsLandingComponent` template at `apps/lfx-one/src/app/modules/docs/pages/docs-landing/docs-landing.component.html` (replacing the placeholder slot left by T024). Depends on T038.
- [x] T040 [US3] Embed `<lfx-docs-search>` in `DocsArticleComponent` template at `apps/lfx-one/src/app/modules/docs/pages/docs-article/docs-article.component.html` so search is reachable from any article page (FR-016). Depends on T038.
- [x] T041 [US3] Implement the no-results empty state UX (FR-019) inside `DocsSearchComponent` — empty-state copy includes the searched term, a hint to try simpler terms, and a link to the landing page topic grid.
- [x] T042 [US3] Configure the build script (T014) to emit `search-index.json` into `apps/lfx-one/public/assets/docs/search-index.json` (or wherever `apps/lfx-one/angular.json` / `project.json` already serves static assets from) so it ships with the production build at a stable URL the service can fetch. Update T014 if the initial path was elsewhere.

**Checkpoint**: US3 complete. Search works from the landing page and any article, ships once as a static asset, runs entirely in the browser.

---

## Phase 6: User Story 4 — Visitor bookmarks and shares URLs (Priority: P2)

**Goal**: Every documentation URL is human-readable (`/docs/<topic>/<slug>`), free of session tokens or query strings, and renders the same content for any future visitor that hits the URL.

**Independent test**: Copy any `/docs/<topic>/<slug>` URL from the address bar after navigating there manually, paste it into a fresh incognito window, confirm identical content. Inspect every URL surfaced by the app and the sitemap — none contain `?session=`, `?token=`, `?u=`, or any other transient parameter.

US4 is largely a property emerging from US1 (the route table at T020/T021 and the sitemap at T013 already produce clean URLs). This phase exists to add explicit verification.

### E2E test for US4

- [x] T043 [P] [US4] Add `apps/lfx-one/e2e/docs/url-stability.spec.ts` covering US4 acceptance scenarios 1–3: copy URL → paste into fresh session → identical render; bookmarked URL still works after navigation away and back; topic-landing pages and articles share the same URL pattern.

### Implementation for US4

- [x] T044 [US4] Add a build-time URL-shape assertion to `apps/lfx-one/scripts/build-docs.mjs`: every `DocsArticle.url` must match `^/docs/[a-z0-9-]+(/[a-z0-9-]+)*$` — no query strings, no fragments, no uppercase, no underscores. Build fails (non-zero exit) on violation. Depends on T014.
- [x] T045 [US4] Verify (and document inline as a comment in `apps/lfx-one/src/app/modules/docs/services/docs-manifest.service.ts`) that the resolver in T021 / T027 normalizes the route URL before lookup so trailing slashes and case variations resolve to the canonical slug — covered by T043's tests.

**Checkpoint**: US4 complete. URL pattern is enforced at build time and validated at runtime.

---

## Phase 7: User Story 5 — Brand-consistent reading experience (Priority: P2)

**Goal**: Articles, the landing page, and the public shell match the LFX Self Serve visual identity — typography, color tokens, headings, code blocks, callouts, tables, and embedded media all align with the rest of the app. Responsive across mobile (360 px), tablet (768 px), and desktop (1024 px / 1440 px). Accessible: keyboard-only navigation, WCAG AA contrast, ARIA labels.

**Independent test**: Open a docs article and a non-docs page (e.g. `/dashboard`) side by side; the typography, link color, code-block treatment, and surface tokens should look like they came from the same product. Open Chrome DevTools, set viewport to 360 px / 768 px / 1024 px / 1440 px in turn, confirm no horizontal scroll, no overlapping content. Run an accessibility audit (axe DevTools or Playwright's `@axe-core/playwright`) and confirm no critical violations.

### Implementation for US5

- [x] T046 [US5] [P] Replace the stub `prose-lfx` typography preset added in T002 with a full `@tailwindcss/typography` configuration in `apps/lfx-one/tailwind.config.js` that maps every prose color slot to LFX brand tokens from `lfxColors` (research R12) — body text, headings, links, code, blockquotes, code blocks, table borders, hr. No raw hex values.
- [x] T047 [US5] [P] Style the `DocsLandingComponent` topic-card grid to match LFX Self Serve card surfaces (existing card patterns from `apps/lfx-one/src/app/shared/components/`); update `apps/lfx-one/src/app/modules/docs/pages/docs-landing/docs-landing.component.{html,scss}`.
- [x] T048 [US5] [P] Style `DocsSidebarNavComponent` to match the small-left-nav visual treatment of `MainLayoutComponent`; update `apps/lfx-one/src/app/modules/docs/components/docs-sidebar-nav/docs-sidebar-nav.component.{html,scss}`. Depends on T033.
- [x] T049 [US5] Add responsive breakpoint coverage E2E test at `apps/lfx-one/e2e/docs/responsive.spec.ts` — viewports 360, 768, 1024, 1440; assert no horizontal scrollbar, search component remains reachable, navigation icons are present.
- [x] T049a [US5] [P] Add markdown-element render coverage at `apps/lfx-one/e2e/docs/markdown-elements.spec.ts` backed by a dedicated fixture article under `apps/lfx-one/e2e/docs/fixtures/all-elements.md` (Playwright-only fixture, not under `docs/user/`). The fixture exercises every FR-012 element class — H1–H6, paragraphs, ordered + unordered lists, tables, blockquotes, inline code, fenced code blocks, links, images, horizontal rules, bold, italic — and the spec asserts each class renders inside the `prose-lfx` container with non-default styling (i.e. brand-token color or typography applied, not the user-agent default). The fixture is registered with the build script (T014) via a documented `--fixtures` flag so it produces a corresponding `/docs/__fixtures__/all-elements` route in the test build only.
- [x] T050 [US5] Add accessibility E2E test at `apps/lfx-one/e2e/docs/a11y.spec.ts` — keyboard-only navigation on landing page and article page, `@axe-core/playwright` audit on both, focus order check, ARIA-label presence on nav and search per FR-026/FR-027.

**Checkpoint**: US5 complete. Pages look and feel native to LFX Self Serve, are responsive, and pass accessibility checks.

---

## Phase 8: User Story 6 — Markdown source-of-truth lifecycle (Priority: P3)

**Goal**: Authors edit markdown under `docs/user/`, open a PR, and once merged the live `/docs/*` content is updated by the next deploy with no parallel publishing step. Adding, renaming, and removing files all flow through the same path. Every markdown file is reachable from the navigation; orphans fail the build.

**Independent test**: On a feature branch, add a new markdown file to `docs/user/<topic>/<new-feature>/index.md`, rebuild, verify the manifest, sitemap, search index, and `/docs/<topic>/<new-feature>` route all pick it up. Then rename the file and rebuild; the old slug 404s, the new slug renders, the sitemap reflects the rename. Then delete the file and rebuild; the slug is gone from the manifest and 404s. Run the build twice on identical input and `git diff` the generated outputs; the diff must be empty.

### Implementation for US6

- [x] T051 [US6] [P] Implement `apps/lfx-one/scripts/check-coverage.mjs` with two invariants. **(1) File coverage (FR-010, FR-022, SC-003)**: walks `docs/user/`, compares the file inventory to `docsManifest.articles`, fails the build if any markdown file under `docs/user/` lacks a corresponding manifest entry. **(2) Navigation reachability (SC-010)**: walks the navigation graph starting from `/docs` (landing → topic landing pages → leaf articles via `breadcrumb` + `siblings` from the manifest), fails the build if any `DocsArticle` is more than 2 hops from `/docs`. Wired to the `docs:check-coverage` npm script (T003).
- [x] T052 [US6] [P] Confirm `docs:check-sitemap` (script implemented in T021a) is invoked by the CI workflow alongside `docs:check-coverage` and `docs:validate`, either via the `docs:check` aggregate (T054) or as an explicit step in the existing GitHub Actions / Turborepo pipeline. No new script work — T021a moved the implementation to Foundational so MVP can use it; this task is the post-launch confirmation that the gate is wired.
- [x] T053 [US6] [P] Implement `apps/lfx-one/scripts/validate-manifest.mjs` — runs `ajv` against `apps/lfx-one/src/app/modules/docs/generated/docs-manifest.ts` (after extracting the `docsManifest` constant via a tiny eval-free import) using [contracts/docs-manifest.schema.json](./contracts/docs-manifest.schema.json) and `apps/lfx-one/src/app/modules/docs/generated/search-index.json` against [contracts/search-index.schema.json](./contracts/search-index.schema.json). Wired to the `docs:validate` npm script (T003).
- [x] T054 [US6] Implement build idempotence assertion in CI: add a one-liner step in the existing CI workflow (or a `docs:check` aggregate script in `apps/lfx-one/package.json`) that runs `yarn docs:build && yarn docs:build` and `git diff --exit-code` against the generated artifacts. Depends on T051, T052, T053.
- [x] T055 [US6] [P] Add a removal flow E2E test at `apps/lfx-one/e2e/docs/lifecycle.spec.ts` (or a Node-side integration test under `apps/lfx-one/e2e/docs/`): take a snapshot of `docsManifest`, delete or rename a fixture article via a temp-branch-style helper, regenerate, confirm the old URL 404s and the new URL resolves. Documented in [quickstart.md](./quickstart.md) §3.

**Checkpoint**: US6 complete. Authors get a single edit-merge-deploy lifecycle. Coverage, schema, and sitemap-parity checks fail the build on drift; idempotence is asserted in CI.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that span multiple stories and final pre-PR validation.

- [x] T056 [P] Document the docs build pipeline and runtime architecture at `docs/architecture/frontend/docs-portal.md` — pipeline diagram, contract references, route registration, layout switching, search lazy-load semantics. Add a row to the Architecture Documentation table in `CLAUDE.md` and `AGENTS.md` only via code-owner review (those files are protected).
- [x] T057 [P] Add a "Last updated" footer to `DocsArticleComponent` template (`apps/lfx-one/src/app/modules/docs/pages/docs-article/docs-article.component.html`) that renders the article's `lastUpdated` field via the existing `formatDate`/`getRelativeDate` utilities from `@lfx-one/shared/utils`.
- [ ] T058 [P] Implement a breadcrumb component at `apps/lfx-one/src/app/modules/docs/components/docs-breadcrumb/docs-breadcrumb.component.{ts,html,scss}` consuming `DocsArticle.breadcrumb`; embed it above the article body in `DocsArticleComponent`.
- [ ] T059 [P] Performance audit: run a Lighthouse pass against three sample article pages and confirm the SC-008 target ("first usable HTML response within 1 second on a typical broadband connection"). Document the run and numbers inline in `apps/lfx-one/e2e/docs/perf-notes.md` (informational, not a blocking gate).
- [x] T060 Run `yarn lint:check && yarn format:check && yarn check-types` from the repo root; fix any drift introduced by US1–US6 implementation.
- [x] T061 Run `yarn build` end-to-end and confirm the generated `dist/lfx-one/browser/assets/docs/search-index.json` and `apps/lfx-one/dist-docs/sitemap.xml` are present and valid against their schemas.
- [ ] T062 Run [quickstart.md](./quickstart.md) end-to-end on a clean checkout — add a fixture article, build, hit it in incognito, run the validation scripts — and update `quickstart.md` if any step has drifted.
- [ ] T063 Invoke the `/preflight` skill (license headers, format, lint, build, protected-file check) per `CLAUDE.md` work-cycle policy.
- [ ] T064 Invoke the post-commit reviewer pair (`lfx-self-serve-code-reviewer` + `lfx-self-serve-learnings-reviewer`) in parallel after the final commit on the branch, then run the pre-PR full-branch sweep with the `branch` arg per `CLAUDE.md` work-cycle policy. Address Critical and reasonable Important findings before opening the PR.
- [ ] T065 Run the `/lfx-self-serve-pr-readiness` skill against `main` and clear every CRITICAL finding before opening the PR.

---

## Dependencies and execution order

### Phase dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories.
- **User stories (Phase 3+)**: All depend on Foundational completion.
  - US1 is the MVP boundary; deliver US1 first.
  - US2–US6 can begin in parallel after US1 lands, or sequentially if a single contributor.
- **Polish (Phase 9)**: Depends on all desired user stories being complete.

### User story dependencies

- **US1 (P1)**: Independent. Foundational only.
- **US2 (P2)**: Builds on US1's `DocsLayoutComponent` (T018) and routing (T020/T021); modifies the same layout component to add auth branching (T034). Best implemented after US1 is on the branch.
- **US3 (P2)**: Independent of US2. Embeds search into US1's pages (T039, T040). Depends on US1's `DocsLandingComponent` and `DocsArticleComponent` existing.
- **US4 (P2)**: Largely a verification phase that builds on US1's URL contract. Best implemented at the same time as US3.
- **US5 (P2)**: Independent of US2, US3, US4. Refines styling produced by US1; can run in parallel after US1.
- **US6 (P3)**: Independent of US2–US5. Adds CI-grade verification; best run last so the test fixtures cover the final manifest shape.

### Within each user story

- E2E tests can be written alongside or after implementation; they MUST pass before the user story phase is considered complete.
- Models and shared types come from Phase 2 — no per-story models needed.
- New components and services with no shared file ([P] in their tasks) can be authored in parallel.
- Component template embeds (T039, T040) depend on the embedded component existing (T038).

### Parallel opportunities

- All Phase 1 [P] tasks can run in parallel.
- Phase 2's [P] tasks (T006, T007, T008, T009, T010, T012, T013, T016, T018, T019, T021a) can run in parallel; T011, T014, T015, T017, T020, T021 are sequential anchors.
- Within US1: T022, T023, T024, T025, T026, T029 are parallelizable; T027, T028, T030 anchor on prior tasks within US1.
- Within US2: T031, T033 are parallelizable; T032, T034, T035 anchor on existing files.
- Within US3: T036, T038 are parallelizable; T037, T039, T040, T041, T042 are sequential.
- Within US4: T043 is parallelizable; T044, T045 modify the shared build script and service.
- Within US5: T046, T047, T048 are parallelizable; T049, T049a, T050 add new test files in parallel.
- Within US6: T051, T052, T053, T055 are parallelizable; T054 is the CI integration anchor. Note: T021a moved the sitemap-parity script implementation to Foundational (Phase 2), so T052 is now a CI-wiring confirmation rather than a script implementation.
- Polish [P] tasks (T056, T057, T058, T059) can run in parallel. T060–T065 are sequential pre-PR gates.

---

## Parallel example: Foundational phase

```bash
# Launch all parallelizable foundational tasks together:
Task: "Add docs interfaces in packages/shared/src/interfaces/docs.interface.ts"           # T006
Task: "Add DOCS_ROUTE_PREFIX constants in packages/shared/src/constants/docs.constant.ts" # T007
Task: "Walk-source helper in apps/lfx-one/scripts/lib/walk-source.mjs"                    # T008
Task: "Marked config in apps/lfx-one/scripts/lib/marked-config.mjs"                       # T009
Task: "Sanitize wrapper in apps/lfx-one/scripts/lib/sanitize.mjs"                         # T010
Task: "Build search index in apps/lfx-one/scripts/lib/build-search-index.mjs"             # T012 (after T011)
Task: "Build sitemap in apps/lfx-one/scripts/lib/build-sitemap.mjs"                       # T013 (after T011)
Task: "Sitemap server route in apps/lfx-one/src/server/routes/sitemap.route.ts"           # T016
Task: "DocsLayoutComponent skeleton in apps/lfx-one/src/app/layouts/docs-layout/"         # T018
Task: "DocsManifestService in apps/lfx-one/src/app/modules/docs/services/docs-manifest.service.ts" # T019
```

## Parallel example: User Story 1

```bash
# Launch all US1 parallelizable tasks together:
Task: "E2E public access spec in apps/lfx-one/e2e/docs/public-access.spec.ts"             # T022
Task: "DocsArticleComponent in apps/lfx-one/src/app/modules/docs/pages/docs-article/"     # T023
Task: "DocsLandingComponent in apps/lfx-one/src/app/modules/docs/pages/docs-landing/"     # T024
Task: "DocsNotFoundComponent in apps/lfx-one/src/app/modules/docs/pages/docs-not-found/"  # T025
Task: "DocsTopicCardComponent in apps/lfx-one/src/app/modules/docs/components/docs-topic-card/" # T026
Task: "robots.txt in apps/lfx-one/public/robots.txt"                                      # T029
```

---

## Implementation strategy

### MVP first (US1 only)

1. Complete Phase 1 (T001–T005).
2. Complete Phase 2 (T006–T021) — the entire pipeline plus shell skeleton.
3. Complete Phase 3 / US1 (T022–T030).
4. **STOP and validate**: Run the public-access E2E suite, hit deep links manually in incognito, confirm `/sitemap.xml` and `/robots.txt`. This is the demoable MVP.
5. Optionally ship US1 alone (the in-app discovery icon is not yet wired, but the public portal is fully functional).

### Incremental delivery

1. Foundation + US1 → Public portal live (MVP).
2. \+ US2 → Signed-in users discover docs via the icon; auth-aware shell engaged.
3. \+ US3 → Search reachable from landing and articles.
4. \+ US4 → URL stability formalized.
5. \+ US5 → Brand styling, responsive, accessible.
6. \+ US6 → CI-grade content lifecycle + idempotence.
7. Polish + pre-PR gates → Open PR.

### Parallel team strategy

After Phase 2 lands, three contributors can fan out:

- Contributor A: US1 + US4 (public-facing, URL contract).
- Contributor B: US2 + US5 (shell, styling, a11y, responsive).
- Contributor C: US3 + US6 (search, CI lifecycle).

US1 must be merged or shared first because US2/US3/US5 depend on its components existing.

---

## Notes

- [P] tasks touch different files and have no in-flight dependencies.
- [Story] labels (US1–US6) trace each implementation task back to the spec.md user story.
- The Foundational phase intentionally produces no user-visible behavior; it exists so each user story phase can be a complete, demoable increment.
- Tests are story-scoped Playwright E2E specs (one per story, scoped to that story's acceptance scenarios). Per `CLAUDE.md`, the project does not enforce TDD; tests can be authored alongside or after implementation, but they MUST pass before the story is considered complete.
- Per `CLAUDE.md` work-cycle: launch the post-commit reviewer pair after every commit on this branch (parallel, asynchronous). Drain the queue clean before opening the PR; run the full-branch sweep on multi-commit branches; clear `/lfx-self-serve-pr-readiness` and `/preflight` before pushing.
- All shared types live in `@lfx-one/shared`; no module-level interfaces inside `apps/lfx-one/`.
- The build script outputs are gitignored (T004) — they are deterministic artifacts of `docs/user/` and the build script.
