# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Auto-loaded by Claude Code at session start. Read this first.
>
> **Important: invoke `/lfx-skills:lfx` for any cross-repo task or "where does X live" question.** Routes to owning repos and pulls in their CLAUDE.md, skills, and rules. If `/lfx-skills:lfx` is not found, install with `/plugin marketplace add linuxfoundation/lfx-skills` then `/plugin install lfx-skills@lfx-skills`.

## Project Overview

LFX One is a Turborepo monorepo containing an Angular 20 SSR application with stable zoneless change detection and Express.js server.

## Working mode

You have full file-edit authority in this session — different from a Cowork session where you generate prompts for someone else to execute. For pre-edit hygiene checks (re-read files, type-check after multi-file changes, etc.) invoke the `/self-serve-dev` skill.

**Lean on subagents.** Use the `Agent` tool for broad searches (`Explore`), independent parallel investigations (multiple Agent calls in one message), and context-heavy reads that would bloat the main thread. For the LFX post-commit audit, launch the reviewer trio — three generic background subagents in one parallel batch (all `subagent_type: general-purpose`, `model: opus` (Opus 5), `run_in_background: true`), each loading exactly one review skill: `/lfx-skills:lfx-general-code-review`, `/lfx-self-serve-code-review`, and `/lfx-self-serve-learnings-review` (see **Pre-PR review** below for the canonical launch). This repo's local `CLAUDE.md`, `.claude/rules/`, `.claude/skills/`, architecture docs, review checklists, and KB remain the review source of truth. Default to delegating when the task is wide, parallel, or read-heavy.

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

## Pre-PR review

Before a PR exists, local review uses the same three reviewers in two modes: **post-commit review** while development continues, and one **full-branch review** immediately before opening the PR.

Every review batch launches exactly THREE generic background subagents together, all with `subagent_type: general-purpose`, `model: opus` (Opus 5), and `run_in_background: true`. At most one batch may be active. The reviewers load exactly one skill each:

1. `/lfx-skills:lfx-general-code-review`
2. `/lfx-self-serve-code-review`
3. `/lfx-self-serve-learnings-review`

The reviewers only report findings. They never edit tracked files, stage, commit, push, or write GitHub state; the parent performs all changes.

### Shared reviewer prompt

Give each reviewer one complete prompt. Start with its loading policy, then append the common instructions.

- General: `Load /lfx-skills:lfx-general-code-review with the Skill tool. If that skill is unavailable, do not review unguided and do not read a replacement SKILL.md from any checkout or cache; return INCOMPLETE.`
- Repo code: `Load /lfx-self-serve-code-review with the Skill tool. If and only if that skill is unavailable in this child's current session, locate the lfx-self-serve repo root and read <repo-root>/.claude/skills/lfx-self-serve-code-review/SKILL.md. Follow that file as the sole review guidance. Do not search another path or use another skill or agent. If the file is missing, return INCOMPLETE.`
- Repo learnings: `Load /lfx-self-serve-learnings-review with the Skill tool. If and only if that skill is unavailable in this child's current session, locate the lfx-self-serve repo root and read <repo-root>/.claude/skills/lfx-self-serve-learnings-review/SKILL.md. Follow that file as the sole review guidance. Do not search another path or use another skill or agent. If the file is missing, return INCOMPLETE.`

```text
target repo: lfx-self-serve
repo root: <absolute repo root>
target_sha: <full target SHA>
base_sha: <full base SHA>
review exactly: git diff <full base SHA> <full target SHA>
range label: <mode-specific range label>

The repo root and SHA range above are authoritative. Do not re-derive the range from HEAD or origin/main. Read added or modified code from <target_sha>:<path>, deleted code from <base_sha>:<path>, and both revisions for a rename. Never use a moving working-tree copy as code evidence. Load current rule, contract, checklist, architecture, and knowledge-base policy as the assigned skill directs.

Report findings only. Follow the assigned skill's report conventions and return its complete findings. Prepend `Reviewed range: <full base SHA>..<full target SHA>`, then `Skill: /lfx-skills:lfx-general-code-review`, `Skill: /lfx-self-serve-code-review`, or `Skill: /lfx-self-serve-learnings-review`, matching that reviewer. If a repo reviewer used its allowed file fallback, append `; read from: <exact path>` to its Skill line. If incomplete, put `INCOMPLETE — <reason>` first, then the same two verification lines.
```

Accept a batch only when all three reviewers return non-empty, complete reports for the pinned full-SHA range, name their exact assigned `/...` skill, and report no unauthorized fallback path. If any reviewer fails these checks, reject the entire batch; never accept or rerun only one reviewer.

### Mode 1 — Post-commit review

Use this mode after normal development commits while work continues.

1. Commit with `git commit -s -S`.
2. Maintain `reviewed_through_sha`: the latest commit fully covered by an accepted post-commit batch. Before the first batch, initialize it to the parent of the first pending commit. Never advance it for a failed or incomplete batch.
3. When no batch is active, set `base_sha=$reviewed_through_sha` and `target_sha=$(git rev-parse HEAD)`. Label a one-commit range `the latest commit`; if commits accumulated, label it `the commits since the last review`.
4. Launch the three reviewers together with that exact range. If another batch is already active, let it finish; the next batch will cover everything from the unchanged `reviewed_through_sha` through the then-current `HEAD`.
5. If the batch is invalid and `HEAD` is unchanged, rerun all three with the same pins. If `HEAD` changed, rerun all three over the coalesced range from the unchanged `reviewed_through_sha` through current `HEAD`.
6. After a valid batch, advance `reviewed_through_sha` to its `target_sha`. Verify its findings against current code and address every Critical and reasonable Important finding in a later commit; that commit is reviewed by the next post-commit batch.
7. The final planned commit skips post-commit review and moves directly to Mode 2. Leave `reviewed_through_sha` unchanged. If development resumes before Mode 2 starts, the next post-commit batch covers the entire pending range from that unchanged SHA.

### Mode 2 — Full-branch review before opening the PR

Entering this mode ends post-commit review for this PR attempt. Finish any active post-commit batch, then do not return to Mode 1.

1. Run `git fetch origin`, set `target_sha=$(git rev-parse HEAD)` and `base_sha=$(git merge-base origin/main HEAD)`, and launch the three reviewers together once against the whole branch range. Use the shared prompt with the range label `the branch's diff against origin/main` and review `git diff <full base SHA> <full target SHA>`. Never use `reviewed_through_sha` for this review.
2. If the batch is operationally incomplete, retry the complete three-reviewer batch without changing the branch until one valid result returns. This obtains the one review; it is not another review pass.
3. Fix the issues raised by that review, run the repository's documentation-currency checks, `/lfx-self-serve-pr-readiness`, and `/preflight`, then create the signed/DCO commit. Do not run the local reviewers again for that commit.
4. Push and open the PR. From that point onward, use Post-PR review only.

## Post-PR review

Once the PR exists, never run the local post-commit reviewers or another local full-branch review. PR iteration uses Copilot and every other configured GitHub code-review agent/bot.

1. After every push, wait for the configured GitHub reviewers to finish reviewing the current head, then enumerate every unresolved review thread. Collect compatible feedback into a batch rather than making one-comment-at-a-time commits.
2. Work in an isolated background task when safe so the developer can continue. Never allow two writers to edit the same worktree or race commits or pushes; otherwise handle the feedback synchronously.
3. Verify every finding against the current head, actual runtime/API contracts, repository guidance, and approved PR scope. Never assume a bot is correct and never silently ignore a finding.
4. For a genuine in-scope issue, make the smallest focused fix and validate it. Otherwise, tell the developer why and post an evidence-backed rebuttal. Escalate architecture, security, ownership, and excluded-surface questions instead of guessing.
5. Comment before resolving every thread. For a fix, cite the fix commit and validation evidence; for a rebuttal, give the reason and evidence. Every thread must end fixed-and-explained or rebutted-and-explained.
6. Group compatible fixes into one signed/DCO commit, push, wait for reviews on the new head, and repeat until no unresolved actionable threads remain and required checks are green.
7. Do not merge as part of this automated iteration. Merge only after a separate explicit human instruction.

## Documentation currency

The canonical Pre-PR step above invokes this check before readiness and preflight. Confirm the change leaves this repo's documentation accurate:

- `docs/reviews/docs-checklist.md` — the documentation review checklist.
- `.claude/rules/development-rules.md` § Documentation Maintenance — what to keep, trim, and never let go stale when editing `docs/`.
- When a convention, contract, or workflow changes, update `CLAUDE.md`, `.claude/rules/`, and the affected architecture docs in the same PR.

After `/compact`, re-invoke `/self-serve-dev` if continuing work that depends on its conventions.

## What NOT to do

- ❌ Edit a file without re-reading it if 5+ turns have passed
- ❌ Replace components in place — for full component replacements use DELETE → CREATE (in-place edits remain fine for non-breaking changes; see `.claude/rules/component-organization.md`)
- ❌ Hard-code brand hex values (reference `lfxColors` scales)
- ❌ Reference browser-only APIs without `isPlatformBrowser`
- ❌ Mix module concerns in one change
- ❌ Deviate from or bypass the authoritative **Pre-PR review** protocol above — including overlapping batches, accepting an invalid reviewer range, leaving commits outside a post-commit batch, or skipping the required full-branch review
- ❌ Open a PR without running `/lfx-self-serve-pr-readiness`, clearing every CRITICAL finding, and addressing or documenting every SHOULD_FIX — also non-negotiable
- ❌ Open a PR without DCO sign-off + GPG (`--signoff -S`)
- ❌ Commit and claim "done" before `yarn build` passes
- ❌ Re-introduce Figma references — design source is HTML/GitHub
- ❌ Edit `CLAUDE.md` or other preflight-protected files without code-owner review
