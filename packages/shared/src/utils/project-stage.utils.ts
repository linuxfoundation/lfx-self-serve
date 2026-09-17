// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectStage } from '../enums/project-stage.enum';

const FORMATION_STAGE_PREFIX = 'Formation - ';

/**
 * Formation sub-stages that are terminal — the project has left active Formation entirely, not just
 * moved between the five in-flight sub-stages — so this gate must deny them even though they match
 * the `Formation - ` prefix (GH-2328). `Formation - Confidential` is deliberately NOT here: it's a
 * confidentiality flag, not a terminal state, and the issue only asks about Disengaged. This is a
 * small named subtraction from the prefix match below, not a replacement of it — see that function's
 * doc comment for why an allow-list would be the wrong fix.
 */
const TERMINAL_FORMATION_STAGES: ReadonlySet<string> = new Set([ProjectStage.FormationDisengaged]);

/**
 * True for any `Formation - *` stage EXCEPT a known-terminal one ({@link TERMINAL_FORMATION_STAGES})
 * — the Formation checklist gate shared by `formationProjectEnabledGuard`, the sidebar's Formation
 * nav-link visibility, and `project-dashboard.component.ts`'s `showFormationEntryCard` (GH-1958,
 * carved for GH-2328), so route access, nav visibility, and the dashboard entry card can't disagree.
 * A prefix match, not a fixed list of the five current `ProjectStage.Formation*` members, so a new
 * Formation sub-stage added upstream (`lfx-v2-project-service`) before this enum is updated still
 * gates on correctly — the terminal set is a small, explicit subtraction from that prefix match, not
 * a replacement of it with an allow-list, which would silently lock out a future sub-stage this
 * function has never heard of. `stage` is `ProjectStage | string` on `Project` for the same reason
 * (tolerates values indexed before this attribute was rolled out), so this accepts a bare string too.
 *
 * `FormationService` (the checklist BFF) deliberately does NOT call this — `getProjectFormation`'s
 * own comment explains why: upstream's `GET /formations/{project_uid}` 404s directly for a project
 * with no formation record, and that 404 is masked as not-found the same way an inaccessible
 * formation is, so a stage check here would be redundant. A Disengaged/terminal project is instead
 * kept off the checklist route entirely by this function's own three call sites (guard denial, nav
 * link hidden, dashboard entry card hidden) — GH-2328 built that as a deny, not a read-only render;
 * whether Disengaged should instead render read-only (like a `completed`/`frozen` `lifecycle`) was
 * raised as an open question in that PR, not decided here.
 *
 * Distinct from `isFormationStage` (`project.utils.ts`) — that one is the GH-1955 badge/card
 * feature's label-lookup check (also treats the `Draft` sentinel as in-Formation); this one never
 * matches `Draft` and tolerates unrecognized Formation sub-stages by design. Keep the two separate
 * rather than merging them — they gate different surfaces with deliberately different edge-case
 * behavior.
 */
export function isFormationStageGate(stage: ProjectStage | string | undefined | null): boolean {
  return typeof stage === 'string' && stage.startsWith(FORMATION_STAGE_PREFIX) && !TERMINAL_FORMATION_STAGES.has(stage);
}

/**
 * Stages where the project has completed (or been retired from) Formation entirely — the formations
 * queue must not list it (LFXV2-3386: an `Active` project's row and tile counts are noise for the
 * formation team). Deliberately a small named deny-list and NOT `!isFormationStageGate`: GH-2366's
 * fail-open rule keeps rows with unrecognized or malformed stages visible (rendered verbatim,
 * counted as unmapped), and `Formation - Disengaged` — terminal for the checklist gate above —
 * deliberately stays visible in the queue so the formation team can still see disengaged work.
 * Inverting the allow-list gate would silently hide both.
 */
const POST_FORMATION_STAGES: ReadonlySet<string> = new Set([ProjectStage.Active, ProjectStage.Archived]);

/**
 * True when a project's stage is post-Formation ({@link POST_FORMATION_STAGES}) — the formations
 * queue's row/tile exclusion predicate (LFXV2-3386). Accepts a bare string for the same
 * tolerate-unindexed-values reason as {@link isFormationStageGate}.
 */
export function isPostFormationStage(stage: ProjectStage | string | undefined | null): boolean {
  return typeof stage === 'string' && POST_FORMATION_STAGES.has(stage);
}
