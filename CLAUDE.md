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

> **CRITICAL — while the branch is pre-PR, post-commit reviews are mandatory.** After every development commit — except the final planned commit when moving immediately into pre-PR, where the mandatory full-branch sweep substitutes — launch exactly THREE generic background subagents in one parallel batch (all `subagent_type: general-purpose`, `model: opus`, `run_in_background: true`). Each child loads exactly one review skill: `lfx-skills:lfx-general-code-review`, `lfx-self-serve-code-review`, or `lfx-self-serve-learnings-review`.
>
> **Batch invariant.** At most ONE review batch may be active. A batch is valid only when all three children return non-empty reports for their assigned skills and state the exact full pinned target/base SHAs at the report's start. A failed, empty, wrong-skill, wrong-range, or `INCOMPLETE` child invalidates the whole batch: resolve the cause and relaunch all three, never one child. If commits land while a trio runs, keep working; after it drains, launch ONE coalesced batch from the last successfully reviewed target through current `HEAD`, labelled `the commits since the last review`. Never launch a full-branch trio while a post-commit trio runs, and never launch both batches for a final commit covered by the final-commit optimization.
>
> **Once the PR is open, stop launching this trio on ordinary iteration commits.** CodeRabbit + Copilot auto-trigger on every push and own that audit surface.

### Post-commit (pre-PR phase, asynchronous)

1. **Commit your work.** Use `git commit --signoff -S`; commits do not wait for an active review. If this is the final planned commit and work is moving immediately into pre-PR, launch NO post-commit batch for it — use the full-branch sweep below.
2. **Pin one complete range when no batch is active.** Track the `target_sha` of the last validly completed three-child batch as the **last successfully reviewed target**. A valid batch establishes that coverage marker even when it reports findings; an invalid batch does not. For a normal batch, pin `target_sha=$(git rev-parse HEAD)`, `base_sha=$(git rev-parse HEAD^)`, and label it `the latest commit`. If commits accumulated during an active trio, drain it, then pin `base_sha` to its last successfully reviewed target, `target_sha` to current `HEAD`, and label the range `the commits since the last review`. Record both full SHAs — shell variables do not survive between tool calls.
3. **Launch all three children in one parallel batch.** Substitute the assigned `<skill>`, the same absolute `<repo-root>`, pinned `<target_sha>` / `<base_sha>`, `<range-label>`, and `<branch-line>` in the canonical prompt below. For post-commit review, `<branch-line>` is empty.
4. **Canonical child prompt (exact for post-commit batches and full-branch sweeps):**

   ```text
   Load exactly one skill and follow it end to end as your complete review playbook: <skill>. Do not load any other review skill. If <skill> is a repo-owned skill and is not listed under any name, read <repo-root>/.claude/skills/<skill>/SKILL.md directly and follow it exactly as if loaded; if you can neither load nor read it, return "INCOMPLETE — could not load <skill>" instead of reviewing without it. If lfx-skills:lfx-general-code-review is unavailable, return "INCOMPLETE — lfx-skills:lfx-general-code-review unavailable" instead of reviewing unguided. Report only: do not edit tracked files, stage, commit, push, or post anything to GitHub — the parent session applies every fix.

   The repo root below is authoritative: run all git commands there and skip the loaded skill's repo-location search. The pinned range below is authoritative: audit target_sha against base_sha exactly, even if HEAD or origin/main moves after launch. Wherever the loaded skill names git show, HEAD, or origin/main...HEAD as its diff range, use git diff <base_sha> <target_sha> instead. For added or modified files, read target_sha:<path>; for deleted files, read base_sha:<path>; for renames, read both base_sha:<old-path> and target_sha:<new-path>. Never use the moving working-tree copy as evidence; load current rule-surface and knowledge-base files as the skill directs.

   Unless the review is INCOMPLETE, the first three lines of the report must be exactly:
   target_sha: <target_sha>
   base_sha: <base_sha>
   skill loaded: <skill>
   If the review is INCOMPLETE, put the INCOMPLETE line first, followed immediately by the same full target_sha and base_sha lines and `skill requested: <skill>`. Return the loaded skill's Markdown report after this required prefix.

   target repo: lfx-self-serve
   repo root: <repo-root>
   <branch-line>
   target_sha: <target_sha>
   base_sha: <base_sha>
   diff range: git diff <base_sha> <target_sha> (<range-label>)
   review exactly: git diff <base_sha> <target_sha>

   Review <range-label>.
   ```

   The repo-owned values are `lfx-self-serve-code-review` and `lfx-self-serve-learnings-review`; their standard discovery aliases are `.claude/skills/local-code-review` and `.claude/skills/local-learnings-review`. For normal review, `<range-label>` is `the latest commit`; for a coalesced batch it is `the commits since the last review`. Append `extra: <focus>` only for a real priority hint. Do not pass `branch` in post-commit mode.

5. **Validate the complete batch before accepting it.** Compare every report's assigned skill and full target/base SHA prefix with the pins. Any omission or mismatch invalidates the whole batch. Do not advance the last successfully reviewed target; relaunch all three under the same pins if the branch has not moved, or coalesced from the prior last successfully reviewed target through current `HEAD` if it has.
6. **Apply findings in the parent session.** Roll every Critical and reasonable Important finding into the next commit. Review children only report.

**Final-commit optimization.** When the commit just made is the final planned commit and work moves immediately into pre-PR, skip its post-commit trio; drain any earlier batch, then run only the full-branch trio. If development resumes before the sweep, return to normal post-commit review.

**Sweep-fix optimization.** Once the full-branch sweep phase begins, every sweep-, readiness-, or preflight-driven fix commit skips the post-commit trio and goes directly to ONE new full-branch trio.

### Pre-PR (drain, sweep, readiness, preflight)

1. **Drain the active batch.** If commits accumulated behind it and work is not entering the final-commit path, launch and drain the required coalesced post-commit batch. A valid returned batch may establish coverage while still producing findings; address those findings before proceeding.
2. **Run the full-branch sweep** when the branch has more than one commit or the final-commit optimization was used (mandatory then even on a single-commit branch). Drain all post-commit work first. Run `git fetch origin`, then pin `target_sha=$(git rev-parse HEAD)` and `base_sha=$(git merge-base origin/main HEAD)`. Launch the same three children with the canonical prompt, `<branch-line>` = `branch`, and `<range-label>` = `the branch's diff against origin/main`. Apply the same prefix/range validation and whole-batch invalidation rule. Address findings, then rerun one complete sweep until clean or explicitly documented as a trade-off.
3. **Run `/lfx-self-serve-pr-readiness`** for branch and commit shape. Address every Critical and address or document every SHOULD_FIX.
4. **Run `/preflight`** for mechanical validation. Any commit created by the sweep, readiness, or preflight returns directly to step 2 — never launch a separate post-commit trio for it.
5. **Only then push and open the PR.** `/lfx-review-pr` remains the post-PR review surface.

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
- ❌ Deviate from or bypass the authoritative pre-PR review work cycle above — including overlapping batches, accepting an invalid child range, leaving commits outside a normal/coalesced batch, or skipping a required full-branch sweep
- ❌ Open a PR without running `/lfx-self-serve-pr-readiness`, clearing every CRITICAL finding, and addressing or documenting every SHOULD_FIX — also non-negotiable
- ❌ Open a PR without DCO sign-off + GPG (`--signoff -S`)
- ❌ Commit and claim "done" before `yarn build` passes
- ❌ Re-introduce Figma references — design source is HTML/GitHub
- ❌ Edit `CLAUDE.md` or other preflight-protected files without code-owner review
