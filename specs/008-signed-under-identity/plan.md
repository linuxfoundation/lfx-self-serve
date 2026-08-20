# Implementation Plan: Show identity each CLA was signed under

**Branch**: `008-signed-under-identity` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-signed-under-identity/spec.md`

Delivery git branch is **`feat/GH-1256`** ([lfx-self-serve#1440](https://github.com/linuxfoundation/lfx-self-serve/pull/1440)), not a new `feat/GH-1573-*`. The spec-kit directory name and the git branch are independent.

## Summary

[#1573](https://github.com/linuxfoundation/lfx-self-serve/issues/1573) shows the identity each CLA was signed under as a second line under the date in the existing Signed cell. The producer already emits `signedVia` (`github` | `gitlab` | `gerrit`) and `signedAs` on each `GET /v4/my-clas` row ([easycla#5151](https://github.com/linuxfoundation/easycla/pull/5151)). Self Serve's mapper currently drops them.

Three things shape the work:

- **Pass-through, not a derivation.** Copy the two fields. Do not reconstruct identity from the session.
- **Copy is three shapes.** GitHub and GitLab get a platform suffix; Gerrit/email does not. Omit the line when there is no identity string.
- **Same cell, every status.** No new column. Revoked and Invalidated still show the line. GitLab is unconditional.

Only `lfx-self-serve` changes. EasyCLA already shipped the producer.

Details: [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).

## Technical Context

**Language/Version**: TypeScript ~5.9.3 on Node 20 (`lfx-self-serve` monorepo: `apps/lfx-one` Angular 20.3 SSR + Express server layer, `packages/shared`)
**Primary Dependencies**: Angular 20 (signals, `ChangeDetectionStrategy.OnPush`), PrimeNG 20.4, existing `gatewayFetch` helper, Vitest 3.2. No new runtime dependency
**Storage**: N/A — nothing persisted. One upstream GET already in flight for the list. The absence of a write path is how FR-008's "informational only" is met structurally
**Testing**: Vitest — `cla.service.spec.ts` (server), `cla-view.utils.spec.ts` (shared), `profile-clas.component.spec.ts` (app). No EasyCLA tests
**Target Platform**: `lfx-one` on lfx-v2 EKS. Reviewer preview `ui-pr-<n>.dev.v2.cluster.linuxfound.info/profile/clas`
**Project Type**: Web application — Angular SSR frontend plus Express server layer, one repository
**Performance Goals**: No extra upstream call. Line is precomputed on the row model so the template does not format per change-detection pass
**Constraints**: No new column; no identity derivation; no GitLab hiding; no `flaggedAt` on this line; no kebab change on Invalidated; land on `feat/GH-1256`
**Scale/Scope**: Two optional fields on the existing view model, one pure helper, one Signed `<td>` edit. No new module, route, or flag

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) is the **unpopulated template** — placeholder principles only, nothing ratified. There are no constitutional gates to evaluate.

**Result: PASS (no ratified principles).** *Simplicity*: copy two fields, one helper, one cell. *Test-first*: pass-through and the three copy shapes fail on current code (fields unused; Signed cell is date-only).

**Post-Phase-1 re-check: PASS.** Phase 1 added no persistence, no dependency, and no package.

## Project Structure

### Documentation (this feature)

```text
specs/008-signed-under-identity/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── signed-under-identity.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository touched)

Only `linuxfoundation/lfx-self-serve`. **Base / push target: `feat/GH-1256` (#1440).**

```text
apps/lfx-one/src/server/
├── types/cla.types.ts                   # + signedVia, signedAs on EasyClaMyCla
└── services/
    ├── cla.service.ts                   # copy in toMyClaAgreement
    └── cla.service.spec.ts

packages/shared/src/
├── interfaces/cla.interface.ts          # + ClaSignedVia; fields on MyClaAgreement
└── utils/
    ├── cla-view.utils.ts                # + signedAsLine helper
    └── cla-view.utils.spec.ts

apps/lfx-one/src/app/modules/profile/clas/
├── profile-clas.component.ts            # ClaRow.signedAsLine precomputed
├── profile-clas.component.html          # date, then the line
└── profile-clas.component.spec.ts
```

**Structure Decision**: Brownfield edit to the existing My CLAs table. No new package.

## Complexity Tracking

No constitution violations. Rejected alternatives are in [research.md](./research.md).
