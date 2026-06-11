---
name: drawer
description: Use when building or modifying a Self Serve drawer component — slide-in detail panels with lazy data loading, chart integration, two-way `[(visible)]` bindings, and the standard responsive width class chain. Trigger phrases include "building a drawer", "open in a drawer", "drawer component", "lazy-load on open", "side panel".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Self Serve Drawer Skill

You are building or modifying a Self Serve drawer. Drawers are slide-in detail panels built on `p-drawer` with strict conventions for visibility, lazy data, chart integration, and responsive sizing.

## When to use

- A new module asks for a "drawer", "side panel", or "detail panel" that slides in.
- An existing drawer needs new sections, charts, or async data.
- A list-row click needs to open detail content without a route change.
- A component currently uses `DialogService.open` for content that should slide rather than modal-pop.

If the work is a modal dialog (not a slide-in), this skill does not apply.

## Workflow

1. **Re-read** `docs/architecture/frontend/drawer-pattern.md` (the reference linked below). The full pattern — visibility model, lazy load via `toObservable(visible).pipe(skip(1), switchMap(...))`, `forkJoin` for parallel calls, chart `computed()` signals, responsive width — is the source of truth.
2. **Check what exists** — read at least one current drawer in the touched module before generating new code to match the team's current shape.
3. **Place files** following the component placement table in `docs/architecture/frontend/component-architecture.md` (and the high-level decision tree in `docs/architecture/placement.md`).
4. **Generate three files** (`.component.ts`, `.component.html`, `.component.scss`) with the LFX license header on each. Follow the 11-section class structure from `.claude/rules/component-organization.md`.
5. **Wire visibility with `model<boolean>(false)`** — two-way `[(visible)]` from the parent.
6. **Lazy-load data on open** — `toSignal` over `toObservable(this.visible).pipe(skip(1), switchMap(...))`; reset `drawerLoading` to `false` on close. `forkJoin` for parallel calls.
7. **Use the standard width chain** — `xl:w-[45%] lg:w-[55%] md:w-[70%] sm:w-[90%] w-full`.
8. **Run `yarn format`** after writing files. Report what was changed.

## Reference

- [`docs/architecture/frontend/drawer-pattern.md`](../../../docs/architecture/frontend/drawer-pattern.md) — the canonical drawer architecture doc. Treat this as the source of truth; do not maintain a separate copy under this skill.

## Scope boundaries

- This skill does NOT cover modal dialogs (`DialogService.open`) — they have a different lifecycle.
- It does NOT cover routing changes — drawers stay in-place.
- For broader component conventions (signals, PrimeNG wrappers, templates), defer to `/self-serve-dev` and `.claude/skills/self-serve-dev/references/frontend-code-generation.md` Section 1.
