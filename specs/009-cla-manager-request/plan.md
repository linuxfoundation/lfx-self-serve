# Implementation Plan: Contact CLA Manager (Request approval / Request Removal)

**Branch**: `009-cla-manager-request` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/009-cla-manager-request/spec.md`

Delivery git branch is **`feat/GH-1372`**. Spec-kit directory and git branch are independent.

## Summary

One shared Contact-CLA-Manager modal on My CLAs with three copy modes. Approval and removal Send the live [easycla#5151](https://github.com/linuxfoundation/easycla/pull/5151) producer. Contact Send is a no-op (producer email always claims an Approved-List change). BFF adds GET managers + POST requests next to existing `clas` routes, using `gatewayFetch` + `identityQuery` + `blockDuringImpersonation` on the write.

Do not edit `profile-clas.component.{ts,html,spec.ts}`. Export `buildContactClaManagerMenuItems` from a new file. Agent A spreads it when `my-clas-m2-enabled` is on.

Details: [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).

## Technical Context

**Language/Version**: TypeScript ~5.9.3 on Node 20 (`lfx-self-serve` monorepo: `apps/lfx-one` Angular 20.3 SSR + Express server layer, `packages/shared`)
**Primary Dependencies**: Angular 20 (signals, `ChangeDetectionStrategy.OnPush`), PrimeNG 20.4 (`p-dialog` via `DialogService` / `DynamicDialog`, `p-checkbox` via shared `lfx-checkbox`), existing `gatewayFetch` helper and `isImpersonating` / `blockDuringImpersonation` guard, Vitest 3.2. No new runtime dependency
**Storage**: N/A — read-only display path plus one upstream POST per approval/removal Send. No Self Serve cache, schema, or table
**Testing**: `vitest run` — `cla.service.spec.ts`, `clas.controller.spec.ts`, `clas.route.spec.ts`, shared action-gate util spec, modal component spec, menu factory spec
**Target Platform**: `lfx-one` on lfx-v2 EKS. Local visual check after `/run-dev` on this worktree only (do not bind :4200 in this pass)
**Project Type**: Web application — Angular SSR frontend plus Express server layer, one repository
**Performance Goals**: One GET per modal open; one POST per approval/removal Send; contact Send is zero extra calls
**Constraints**: No profile-clas edits; contact never POSTs; impersonation blocks writes; factory does not read LaunchDarkly; `requestType` enum is `approval`|`removal` only
**Scale/Scope**: New modal + two BFF routes + shared visibility helpers. Lands on `feat/GH-1372` cut from `feat/GH-1256` HEAD

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) is the **unpopulated template** — placeholder principles only, nothing ratified. There are no constitutional gates to evaluate.

**Result: PASS (no ratified principles).** *Simplicity*: reuse `gatewayFetch`, `claServiceBaseUrl()`, `identityQuery`, `blockDuringImpersonation`, `DialogService` pattern from GitHub-account select. No new env var. *Test-first*: assertions that fail before the routes exist. *Observability*: `logger.success` on get-managers / create-request with signature id and request type, not the message body.

**Post-Phase-1 re-check: PASS.** No persistence, no new package, no second flag name.

## Project Structure

### Documentation (this feature)

```text
specs/009-cla-manager-request/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cla-manager-request.md      # BFF ↔ producer
│   └── contact-cla-manager-ui.md   # modal + kebab factory
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository touched)

Only `linuxfoundation/lfx-self-serve`. **Base: `feat/GH-1256` HEAD. Branch: `feat/GH-1372`.**

```text
apps/lfx-one/src/server/
├── routes/clas.route.ts                 # GET managers + POST requests (write gated)
├── routes/clas.route.spec.ts
├── controllers/clas.controller.ts
├── controllers/clas.controller.spec.ts
├── services/cla.service.ts              # getClaManagers / createClaManagerRequest
├── services/cla.service.spec.ts
└── types/cla.types.ts                   # EasyCla manager types

packages/shared/src/
├── interfaces/cla.interface.ts          # client DTO
└── utils/cla-manager-actions.utils.ts   # NEW — visibility predicates
└── utils/cla-manager-actions.utils.spec.ts

apps/lfx-one/src/app/
├── modules/profile/clas/
│   ├── contact-cla-manager.component.ts      # NEW modal
│   ├── contact-cla-manager.component.html
│   ├── contact-cla-manager.component.spec.ts
│   ├── contact-cla-manager-menu.ts           # NEW factory
│   └── contact-cla-manager-menu.spec.ts
└── shared/services/my-clas.service.ts   # GET/POST client methods
```

**Do not touch:** `profile-clas.component.ts`, `.html`, `.spec.ts`.

**Structure Decision**: Brownfield append on existing CLAs BFF. New dialog sibling of `github-account-select`. Visibility logic lives in shared (framework-free) so the factory stays a thin DialogService wrapper.

## Complexity Tracking

| Constraint | Why it arises | How the requirement is met instead |
|---|---|---|
| Producer has no `contact` requestType; email always asks for an Approved-List change | #5151 templates | Contact Send is a no-op. FR-004 / FR-013 |
| Cannot edit profile-clas (parallel Agent A) | Dirty GH-1256 tree | Exported factory; one-liner in the report |
| 002 “real actions only” vs v17 Contact item | Stub vs product no-op | Spec exception; still no lying POST |
