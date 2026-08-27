# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Auto-loaded by Claude Code at session start. Read this first.
>
> **Important: invoke `/lfx-skills:lfx` for any cross-repo task or "where does X live" question.** Routes to owning repos and pulls in their CLAUDE.md, skills, and rules. If `/lfx-skills:lfx` is not found, install with `/plugin marketplace add linuxfoundation/lfx-skills` then `/plugin install lfx-skills@lfx-skills`.

## Project Overview

LFX One is a Turborepo monorepo containing an Angular 20 SSR application with stable zoneless change detection and Express.js server.

## Working mode

You have full file-edit authority in this session — different from a Cowork session where you generate prompts for someone else to execute. For pre-edit hygiene checks (re-read files, type-check after multi-file changes, etc.) invoke the `/self-serve-dev` skill.

**Lean on subagents.** Use the `Agent` tool for broad searches (`Explore`), independent parallel investigations (multiple Agent calls in one message), and context-heavy reads that would bloat the main thread. For the LFX post-commit audit, launch the reviewer trio — three generic background subagents in one parallel batch (all `subagent_type: general-purpose`, `model: opus`, `run_in_background: true`), each loading exactly one review skill: `lfx-skills:lfx-general-code-review`, `lfx-self-serve-code-review`, and `lfx-self-serve-learnings-review` (see the work cycle below for the canonical launch). This repo's local `CLAUDE.md`, `.claude/rules/`, `.claude/skills/`, architecture docs, review checklists, and KB remain the review source of truth. Default to delegating when the task is wide, parallel, or read-heavy.

## Domain language

Use these naturally — do not paraphrase:

- **PCC** — Project Control Center
- **ED** — Executive Director
- **Admin Mode** — privileged view variant for EDs and admins
- **Affiliation** — contributor's company/org link
- **L2** — second-level navigation pattern
- **Personas** — Contributor, Maintainer, ED, Board Member

When a feature affects multiple personas differently, flag it explicitly.

## Quick Start

**Prerequisites:** Node.js ≥22 and Yarn 4.x (via corepack). Docker or OrbStack is only needed when running the optional local microservice stack; normal app development uses the shared dev environment.

For first-time setup (1Password env vars, microservice stack, etc.) invoke the `/setup` skill — it handles prerequisites, clone, install, env vars, and the dev server.

## Commands

All commands run from the repo root via Turborepo:

| Command             | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| `yarn start`        | Angular dev server with hot reload (via Turbo)      |
| `yarn build`        | Production build (all packages)                     |
| `yarn lint`         | Lint + auto-fix across the monorepo                 |
| `yarn lint:check`   | Lint without auto-fix (CI mode)                     |
| `yarn check-types`  | TypeScript type-check only (no emit)                |
| `yarn format`       | Prettier write across the repo                      |
| `yarn format:check` | Prettier check (CI mode)                            |
| `yarn e2e`          | Playwright E2E suite (headless)                     |
| `yarn e2e:ui`       | Playwright in interactive UI mode                   |
| `yarn e2e:headed`   | Playwright headed, visible browser                  |
| `yarn commitlint`   | Validate commit message against Angular conventions |

> For manual commands, prefer `yarn` over `npx` — the repo pins Yarn 4.x through `packageManager`, so `npx` can resolve to the wrong binary. Repo-managed tooling (e.g. `.husky/pre-commit` invokes `npx lint-staged`) may still use `npx` where already configured.

### Reset / cleanup

```bash
yarn ng cache clean        # Angular CLI cache (uses the workspace-local ng)
yarn turbo clean           # Turborepo build cache (turbo is a local devDep)
rm -rf node_modules && yarn install   # nuclear
```

Hot reload silent? Likely `inotify` watcher limit — `sudo sysctl fs.inotify.max_user_watches=524288`.

## Monorepo Structure

```text
lfx-self-serve/
├── apps/
│   └── lfx-one/              # Angular 20 SSR application with stable zoneless change detection
│       ├── src/app/
│       │   ├── layouts/      # Layout components (main-layout, profile-layout)
│       │   ├── modules/      # Feature modules (see Feature Modules section)
│       │   └── shared/       # Shared application code
│       │       ├── components/   # UI components (PrimeNG wrappers + LFX primitives)
│       │       ├── directives/   # Custom directives (on-render, scroll-shadow)
│       │       ├── guards/       # Route guards (auth, writer, executive-director)
│       │       ├── interceptors/ # HTTP interceptors (authentication)
│       │       ├── pipes/        # Custom pipes
│       │       ├── providers/    # App providers (datadog-rum, feature-flag, runtime-config)
│       │       ├── services/     # Frontend services
│       │       ├── strategies/   # Routing strategies (custom-preloading)
│       │       └── utils/        # App utilities (console-override, download-card, http-error, etc.)
│       ├── src/server/       # Express.js SSR server
│       │   ├── constants/    # Server-only constants
│       │   ├── controllers/  # Route controllers
│       │   ├── errors/       # Custom error classes (base, authentication, microservice, service-validation)
│       │   ├── helpers/      # Server helpers (api-gateway, error-serializer, http-status, ics, meeting, poll-endpoint, query-service, url-validation, validation)
│       │   ├── middleware/   # Express middleware (auth, error-handler, rate-limit, require-executive-director)
│       │   ├── pdf-templates/ # PDF generation templates (e.g., visa-letter-manual)
│       │   ├── routes/       # API route definitions
│       │   ├── services/     # Backend services (api-client, microservice-proxy, nats, snowflake, etc.)
│       │   ├── utils/        # Server utilities (auth-helper, lock-manager, m2m-token, persona-helper, security)
│       │   ├── server.ts     # Express server entry point
│       │   ├── server-logger.ts # Pino logger configuration
│       │   └── server-tracer.ts # OpenTelemetry tracer configuration
│       ├── e2e/              # Playwright E2E tests (dual architecture: content + structural)
│       ├── playwright/       # Playwright helpers and fixtures
│       ├── eslint.config.js  # Angular-specific ESLint rules
│       ├── .prettierrc.js    # Prettier configuration with Tailwind integration
│       ├── ecosystem.config.js # PM2 production configuration
│       ├── otel.mjs          # OpenTelemetry instrumentation bootstrap
│       ├── postcss.config.js # PostCSS configuration (Tailwind + autoprefixer)
│       └── tailwind.config.js # Tailwind with PrimeUI plugin and LFX colors
├── packages/
│   └── shared/               # Shared types, interfaces, constants, utilities, and validators
│       ├── src/
│       │   ├── interfaces/   # TypeScript interface files (meetings, committees, auth, projects, etc.)
│       │   ├── constants/    # Constant files (design tokens, API config, domain constants)
│       │   ├── enums/        # Shared enumerations (committee, meeting, poll, survey, etc.)
│       │   ├── utils/        # Utility modules (date, string, url, meeting, poll, survey, project, etc.)
│       │   └── validators/   # Form validators (meeting, mailing-list, vote)
│       ├── package.json      # Package configuration with proper exports
│       └── tsconfig.json     # TypeScript configuration
├── docs/                     # Architecture and deployment documentation
├── turbo.json               # Turborepo pipeline configuration
└── package.json             # Root workspace configuration
```

## Feature Modules

The application is organized into feature modules under `apps/lfx-one/src/app/modules/`:

| Module            | Description                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| **badges**        | LFX badges — view and manage credentialing badges earned across projects         |
| **committees**    | Committee management — view, create, and manage project committees               |
| **dashboards**    | Lens-based dashboards (Me, Foundation, Project, Org) and supporting drawers      |
| **documents**     | Document management — browse and manage project documents                        |
| **events**        | Events — browse LFX events and manage attendance                                 |
| **invite**        | Invite acceptance — token-based invite landing and error pages                   |
| **mailing-lists** | Mailing list management — subscribe, unsubscribe, and manage lists               |
| **meetings**      | Meeting scheduling — create, manage, and join meetings with calendar integration |
| **newsletters**   | Newsletter management — list, manage, and view newsletter analytics              |
| **profile**       | User profile — profile management and account settings                           |
| **settings**      | Application settings — preferences and configuration                             |
| **surveys**       | Survey management — create surveys, collect responses, view NPS analytics        |
| **trainings**     | Training enrollments — view and manage training programs                         |
| **transactions**  | Transactions — view billing / purchase history                                   |
| **votes**         | Voting system — create polls, cast votes, and view results                       |

## Shared Package

The `@lfx-one/shared` package centralizes types, constants, enums, utilities, and form validators consumed by both the Angular app and the Express server. The path alias `@lfx-one/shared/*` resolves directly to `packages/shared/src/*` during development (hot-reloadable, no rebuild needed).

Common import patterns:

```typescript
import { formatDate, getRelativeDate, normalizeToUrl } from '@lfx-one/shared/utils';
import { User, AuthContext } from '@lfx-one/shared/interfaces';
import { futureDateTimeValidator } from '@lfx-one/shared/validators';
```

Utilities split into **generic** helpers (date/time, string, url, file, form, html, color) and **domain** helpers (meeting, poll, survey, vote, rsvp-calculator, project, committee, badge, rewards, insights, etc.). See [Package Architecture docs](docs/architecture/shared/package-architecture.md) for conventions, import patterns, and the full how-to for adding new items.

## Gotchas & Conventions

### Commits & PRs

- Follow Angular commit format: `type(scope): description`. Valid types: `feat, fix, docs, style, refactor, perf, test, build, ci, revert` — **`chore` is not allowed** by commitlint.
- Commit header targets **≤72 characters** as a team style. Commitlint hard-fails at >100 (`@commitlint/config-angular` default; the repo doesn't override `header-max-length`). 73–100 will land but is a SHOULD_FIX in the PR-shape check.
- Always use `git commit --signoff -S` — both DCO sign-off (`--signoff`) and GPG signing (`-S`) are enforced by repo policy. See `.claude/rules/commit-workflow.md` for setup.
- Pre-commit runs `./check-headers.sh`, `npx lint-staged` (prettier + lint on staged files), then repo-wide `yarn format:check`, `yarn lint:check`, and `yarn check-types`. Only `lint-staged` is scoped to staged files — the rest run on the whole repo. You don't need to run `yarn format` manually; `lint-staged` already prettifies staged files. If a commit fails, fix the reported issue and retry.
- See `.claude/rules/commit-workflow.md` for PR title / sizing / ticket-tracking (JIRA or GitHub Issue) details.

For missing sign-off recovery (single-commit amend, or older commits / cherry-picks / rebases), invoke the `/dco` skill.

### Source hygiene

- Every source file needs the MIT license header — `./check-headers.sh` validates and the pre-commit hook enforces.
- Never nest ternary expressions.
- Use `flex + flex-col + gap-*`, not `space-y-*`, for vertical stacking.
- All shared constants and interfaces live in `@lfx-one/shared` — no module-level consts or local `interface Foo {}` inside `apps/lfx-one/`.
- Within `@lfx-one/shared`, types live in `interfaces/` and values live in `constants/`: `export type` (including derived aliases like `(typeof CONST)[keyof typeof CONST]`) belongs in a `.interface.ts`; constants files export runtime values only.

### Architecture

- Always reference PrimeNG's component interface when defining types — all PrimeNG components are wrapped in LFX components for UI library independence.
- Use direct imports for standalone components (no barrel exports).
- Authentication is selective: public routes (`/meetings/` SSR pages, `/public/api`) allow anonymous access (optional auth), protected routes require it. Auth0/Authelia via express-openid-connect; custom `/login` handler with URL validation. Prefer user bearer tokens over M2M tokens except in genuinely public endpoints — see `.claude/rules/development-rules.md` for the M2M usage rules.

### Dev server

- Don't restart the dev server on code changes — hot reload handles it. Check logs instead.

## Design source of truth

Design lives as HTML in a separate GitHub design repo, generated via Cowork sessions. **Not Figma.**

When implementing from a design:

1. Fetch the HTML from the design repo at the specified commit
2. Treat the markup as the visual spec — markup-faithful conversion expected
3. Convert to Angular component preserving structure
4. Add what HTML doesn't capture:
   - ARIA roles, focus management
   - Signals / `@Input` / state
   - Interactive states: hover, active, loading, error, empty
   - Responsive breakpoints
   - SSR safety (see `.claude/rules/ssr-safety.md`)

The HTML is the **visual** spec. Behavior needs explicit input.

For local auth issues (Authelia at `auth.k8s.orb.local`, broken cookies, client-secret fetch, session inspection), invoke the `/setup` skill.

## Source of truth, in order

1. **Code on disk** — re-view; don't trust history
2. **`apps/lfx-one/src/app/`** — the running app
3. **`packages/shared/`** — types and contracts shared with backend
4. **The design repo** — for visual spec
5. **This file + `.claude/rules/`** — for conventions

## Rule Files

Detailed patterns are in `.claude/rules/` and loaded contextually based on the `paths:` frontmatter in each file. The full table of rule files, paths, and topics lives in `.claude/rules/skill-guidance.md`.

## Architecture Documentation

The full index of architecture docs (frontend, backend, shared, testing, deployment routing) lives in [`docs/architecture/README.md`](docs/architecture/README.md). Reviewers and skill workflows load these conditionally by changed-file path.

Placement decision trees ("where does my component go?", "do I need a new module?", "new service or extend existing?", "user token vs M2M?") live in [`docs/architecture/placement.md`](docs/architecture/placement.md).

## Work cycle — post-commit and pre-PR reviews

> **CRITICAL — while the branch is pre-PR, post-commit reviews are mandatory.** After every commit on the local branch, launch the reviewer trio — **exactly three generic background subagents in one parallel batch** via the Agent tool (all `subagent_type: general-purpose`, `model: opus`, `run_in_background: true`), each loading exactly one review skill: `lfx-skills:lfx-general-code-review`, `lfx-self-serve-code-review`, and `lfx-self-serve-learnings-review` — then keep working while they run. If Claude displays the plugin skill without the `lfx-skills:` namespace, use the displayed name. Before opening a PR, every running review must return clean (or remaining findings explicitly documented as trade-offs), the **full-branch sweep** must run clean if the branch has more than one commit (`branch` arg), AND `/lfx-self-serve-pr-readiness` must clear every CRITICAL finding, with any SHOULD_FIX findings addressed or documented. The reviewers' time is the most expensive resource in this workflow — never skip, save for later, or assume changes are "small enough" to bypass.
>
> **Once the PR is open, do NOT invoke the reviewer trio on iteration commits.** CodeRabbit + Copilot auto-trigger on every push and own the audit surface from that point — stacking subagent audits on top adds latency without proportional signal. The trio is pre-PR insurance only. (For substantive new work pushed to an open PR, judgment applies; default is still to skip.)

### Post-commit (pre-PR phase, after every commit, parallel, asynchronous)

1. **Commit your work.** `git commit --signoff -S`. Do not wait for any prior review to finish.
2. **Immediately pin the review range, then launch all three reviewer children in parallel.** Compute once, right after the commit:

   ```bash
   TARGET_SHA=$(git rev-parse HEAD)
   BASE_SHA=$(git rev-parse HEAD~1)
   ```

   Then issue three **Agent tool calls in a single message** — all `subagent_type: general-purpose`, `model: opus`, `run_in_background: true`. Each child explicitly loads exactly one review skill, and all three receive the same target repo and the same immutable `target_sha` / `base_sha` / diff range:
   - **General review child** — loads **`lfx-skills:lfx-general-code-review`**: general senior code review for correctness, security, error handling, maintainability, tests, performance, and code truthfulness. Carries no repo-specific Self Serve rulebook.
   - **Self Serve convention child** — loads **`lfx-self-serve-code-review`** (`.claude/skills/lfx-self-serve-code-review/`): Self Serve convention audit against the documented rule surface (`.claude/rules/`, the four `docs/reviews/` checklists, architecture docs) and upstream API contracts. Renders a markdown review with Upstream API / data-layer validation and Repo conventions sections.
   - **Self Serve learnings child** — loads **`lfx-self-serve-learnings-review`** (`.claude/skills/lfx-self-serve-learnings-review/`): empirical-pattern matching against `docs/reviews/knowledge-base/` (patterns sampled from past PR review comments on this repo). Renders a markdown review.

   **Why a canonical prompt:** the Agent tool needs a non-empty prompt to launch reliably, so we standardize on one canonical string per mode rather than leave it ambiguous. Each skill's playbook parses for `target repo:`, `branch`, and `extra:` and, when given no pins, defaults to `git show HEAD` — a moving reference. The canonical prompt therefore pins `target_sha` / `base_sha` / the exact diff range and declares them authoritative, so all three children audit the same exact range even if you commit again while the reviews run; the prompt's pinned-range line is what binds the child, so never omit it. The `model: opus` pin lives here in the caller (the skill files carry no model frontmatter). If this work cycle is launched from the LFX workspace parent, the prompt must specify the target review repo so the reviewer operates in `lfx-self-serve`; the canonical prompts below include that line and are also safe when already inside this repo. If a skill is displayed with a namespace or directory-scope prefix (e.g. `work:lfx-self-serve-code-review`), use the displayed name.

   **Post-commit mode prompt (exact, all three children — substitute the child's skill name and the pinned SHAs):**

   ```text
   Load exactly one skill and follow it end to end as your complete review playbook: <skill>. Do not load any other review skill.

   The pinned range below is authoritative: audit target_sha against base_sha exactly, even if HEAD has moved since launch — never re-derive the range from a moving HEAD.

   target repo: lfx-self-serve
   target_sha: <TARGET_SHA>
   base_sha: <BASE_SHA>
   diff range: git diff <BASE_SHA> <TARGET_SHA> (the single commit target_sha)

   Review the latest commit.
   ```

   where `<skill>` is `lfx-skills:lfx-general-code-review`, `lfx-self-serve-code-review`, or `lfx-self-serve-learnings-review` respectively. Append `extra: <focus>` on a new line only when there's a priority hint to add. Do NOT pass `branch` here.

3. **Keep working.** Start the next commit while the reviewers run. Do not block on them.
4. **When the reviewers return:** read all three reports. Roll every Critical finding and every reasonable Important finding into the next commit (a separate `fix(review): address findings` commit is fine; squashing is not required — the history shows review-driven iteration).
5. **It's fine to keep committing while reviews are still running.** Each trio audits its own commit (not cumulative). If you've committed N+1 before the review for N returns, you'll get separate reports — one trio per commit. Read them as they arrive and address findings in subsequent commits.

### Pre-PR (drain the queue, sweep cumulative state, then open)

When the work is "done" — no more code commits planned:

1. **Wait for every running review to complete.** Each trio audits one commit, so the trio invoked by every recent commit needs to have returned before you continue.
2. **If any returned review flags Critical or reasonable Important:** add a fix commit, launch the reviewer trio again on the new state, wait. Loop until the trio returns clean (or remaining findings are explicitly documented in the PR description with a stated trade-off).
3. **Full-branch sweep — only if the branch has more than one commit.** Launch the same three reviewer children again in one parallel batch via the Agent tool (all `subagent_type: general-purpose`, `model: opus`, `run_in_background: true`, each loading its same single skill). Pin the range first:

   ```bash
   git fetch origin
   TARGET_SHA=$(git rev-parse HEAD)
   BASE_SHA=$(git merge-base origin/main HEAD)
   ```

   The prompt for each child must include the `branch` keyword so the loaded skill audits the branch's diff against `origin/main` instead of just the latest commit. **Full-branch mode prompt (exact, all three children):**

   ```text
   Load exactly one skill and follow it end to end as your complete review playbook: <skill>. Do not load any other review skill.

   The pinned range below is authoritative: audit target_sha against base_sha exactly, even if HEAD or origin/main has moved since launch — never re-derive the range from a moving HEAD or re-fetch the base.

   target repo: lfx-self-serve
   branch
   target_sha: <TARGET_SHA>
   base_sha: <BASE_SHA>
   diff range: git diff <BASE_SHA>...<TARGET_SHA>

   Review the branch's diff against origin/main.
   ```

   Per-commit reviews can miss cross-commit drift (an issue introduced in commit N and only made dangerous by commit N+2's changes wouldn't surface in either's individual review); the sweep catches it. Single-commit branches skip — already covered by the post-commit trio. Address any new findings, then re-run the sweep until clean.

4. **Run `/lfx-self-serve-pr-readiness`** against the target base branch. PR-shape sanity: branch name, ticket reference (JIRA or GitHub Issue), conventional commits, rebase, DCO + GPG per commit, diff size. Does NOT audit code (covered by the post-commit trio and the full-branch sweep). Address every Critical; address or document every SHOULD_FIX. Rerun until the verdict is `READY` or `READY WITH CHANGES` with explicit trade-offs.
5. **Run `/preflight`** for license / format / lint / build / protected-file mechanical checks.
6. **Only then push and open the PR.** (Reviewers run `/lfx-review-pr` against the open PR — that should not be your first standards check.)

### Post-PR iteration (responding to bot feedback on an open PR)

1. Wait for CodeRabbit + Copilot to comment after each push.
2. Triage every Critical and reasonable Important finding — verify each against current code (bots can quote stale paths or APIs).
3. Roll fixes into a single `fix(review): ...` commit. Reply + resolve each thread (`gh api repos/<owner>/<repo>/pulls/<N>/comments/<id>/replies` + the `resolveReviewThread` GraphQL mutation).
4. Push. Repeat until clean.

After `/compact`, re-invoke `/self-serve-dev` or the relevant convention skill if continuing work that depends on it.

## What NOT to do

- ❌ Edit a file without re-reading it if 5+ turns have passed
- ❌ Replace components in place — for full component replacements use DELETE → CREATE (in-place edits remain fine for non-breaking changes; see `.claude/rules/component-organization.md`)
- ❌ Hard-code brand hex values (reference `lfxColors` scales)
- ❌ Reference browser-only APIs without `isPlatformBrowser`
- ❌ Mix module concerns in one change
- ❌ Open a PR without launching the post-commit reviewer trio (three generic background children in one parallel batch, loading `lfx-skills:lfx-general-code-review` + `lfx-self-serve-code-review` + `lfx-self-serve-learnings-review`) after every pre-PR commit and draining the queue clean — all three reviews are non-negotiable pre-PR
- ❌ Push the pre-PR queue before every running review has returned and every Critical finding is addressed (the queue must be drained at the PR boundary; once the PR is open, the bots become the audit surface and the trio is no longer invoked)
- ❌ Open a multi-commit PR without running the pre-PR full-branch sweep (`branch` arg) — per-commit reviews can miss cross-commit drift
- ❌ Open a PR without running `/lfx-self-serve-pr-readiness`, clearing every CRITICAL finding, and addressing or documenting every SHOULD_FIX — also non-negotiable
- ❌ Open a PR without DCO sign-off + GPG (`--signoff -S`)
- ❌ Commit and claim "done" before `yarn build` passes
- ❌ Re-introduce Figma references — design source is HTML/GitHub
- ❌ Edit `CLAUDE.md` or other preflight-protected files without code-owner review
