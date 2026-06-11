---
name: lens-persona
description: Use when touching Self Serve dashboards, persona behavior, lens switching, `LensService`, `ProjectContextService`, or any code that varies behavior by user persona (Contributor, Maintainer, ED, Board Member, Admin Mode). Trigger phrases include "lens", "persona", "ED mode", "Admin Mode", "PCC", "dashboard variant".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Self Serve Lens & Persona Skill

You are working on code that depends on the Self Serve lens/persona system: dashboards, persona-aware components, the lens switcher, or any conditional behavior driven by `LensService` or `ProjectContextService`.

## When to use

- The user mentions "lens", "persona", "PCC", "ED mode", "Admin Mode", "Maintainer view", or any persona variant.
- A change touches `dashboards/` modules.
- A component needs to gate UI behind persona checks (`isMaintainer`, `isVisitor`, `canEdit`, `hasPMOAccess`, or an ED check via `PersonaService` / `executiveDirectorGuard`).
- A change touches `LensService`, `ProjectContextService`, or persona helpers.
- A change touches `apps/lfx-one/src/server/utils/persona-helper` or `auth-helper`.

## Workflow

1. **Re-read** `docs/architecture/frontend/lens-system.md` (the reference linked below) plus `docs/architecture/frontend/permission-persona-navigation-model-preread.md` for the navigation/permission model.
2. **For backend persona work**, also read `docs/architecture/backend/impersonation.md`.
3. **Identify which persona(s) the change applies to** and call them out explicitly in the plan. Self Serve personas are: Contributor, Maintainer, ED, Board Member. Admin Mode is a privileged variant for EDs and admins.
4. **Gate UI with the right signal** — `!myRoleLoading() && !isVisitor()` (not just `!isVisitor()`) so content does not flash while the role is loading. This is a documented learnings-reviewer pattern.
5. **Do not duplicate persona detection** — funnel through `LensService` / `ProjectContextService` / the relevant persona helper.
6. **For permission changes** (adding/removing/changing `canEdit()`, `isVisitor()`, `hasPMOAccess()`), document the change in the PR description.
7. **Coordinate with the persona backend service when shapes change** — `lfx-v2-persona-service` owns the persona aggregation contract; treat it as a peer repo.

## Reference

- [`docs/architecture/frontend/lens-system.md`](../../../docs/architecture/frontend/lens-system.md) — the canonical lens/persona architecture doc. Treat this as the source of truth; do not maintain a separate copy under this skill.

## Scope boundaries

- This skill does NOT cover Auth0/Authelia login flow (see `docs/architecture/backend/authentication.md`).
- It does NOT cover the upstream persona aggregation service (route persona-aggregation work to `lfx-v2-persona-service` via `/lfx-skills:lfx`).
