# Knowledge Graph Change Log

## 2026-06-29 (Task 4 — APIs & Data Models)

**API concept files (3 files)** — Added `docs/okf/apis/` directory with concept files: `authenticated-api.md` (protected `/api/**` routes with bearer token auth and rate limiting), `public-api.md` (unauthenticated `/public/api/**` routes with M2M token upstream calls), and `ssr-server.md` (Express entry point with Angular Universal SSR, middleware orchestration, and 30+ route mounting). Each includes YAML frontmatter with `type: APIGroup` or `type: Service`, overview, route coverage tables, rate-limiting strategy, middleware pipeline, and citations to architecture docs and source files.

**Data model concept files (2 files)** — Added `docs/okf/data-models/` directory with concept files: `shared-package.md` (centralized `@lfx-one/shared` package with interfaces, enums, utilities, validators, and constants; import patterns; hot-reload behavior; and adding-new-items guide) and `auth-context.md` (authentication state structure, user vs M2M token distinction, persona system, session/SSR flow, frontend state management, and impersonation). Each includes YAML frontmatter with `type: DataModel`, overview, key fields/contents table, detailed responsibilities, dependencies, and citations.

## 2026-06-29

**Angular module concept files (9 files)** — Added `docs/okf/modules/` directory with concept files for all feature modules: `badges.md`, `committees.md`, `dashboards.md`, `events.md`, `mailing-lists.md`, `meetings.md`, `newsletters.md`, `surveys.md`, `votes.md`. Each concept includes YAML frontmatter with `type: AngularModule`, overview, entry points from routing files, key components, backend surface references, related concepts, and citations to source files and routing configurations.

**Service concept files (10 files)** — Added `docs/okf/services/` directory with concept files for all backend services: `ai-service.md`, `auth-service.md`, `committee-service.md`, `mailing-list-service.md`, `meeting-service.md`, `nats-service.md`, `newsletter-service.md`, `snowflake-service.md`, `survey-service.md`, `valkey-service.md`. Each concept includes YAML frontmatter with `type: Service`, overview, key responsibilities, dependencies, related concepts, and citations to architecture docs and source files.

**Creation** — Initial OKF v0.1 bundle root for `lfx-self-serve`. Created `index.md` (progressive-disclosure catalog declaring 31 concepts across 6 sections) and `log.md` (this file). Concept files to follow in subsequent commits. Bundle on branch `feat/okf-knowledge-graph`.
