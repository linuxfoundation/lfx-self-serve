// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_SUB_STAGE_LABELS, FORMATION_SUB_STAGE_SEVERITY, UPSTREAM_SUB_STAGE_TO_FORMATION_SUB_STAGE } from '../constants/formation.constants';
import type { TagSeverity } from '../interfaces/components.interface';
import type { Formation, FormationEntityType, FormationSubStage } from '../interfaces/formation.interface';

/**
 * Derives the Formations queue's Type-column taxonomy from the two inputs the formation service
 * serves (#1957, GH-2163 §1) — confirmed 8 Sep as "nothing stored, and we can derive." Never
 * store the result; call this wherever {@link FormationEntityType} is needed.
 *
 * `parent_uid` must already be `null` for a top-level project, not the hidden `ROOT` project's
 * UID — see {@link Formation.parent_uid}'s doc comment for why. The check below is deliberately
 * falsy (`!formation.parent_uid`), not a strict `=== null`, matching this repo's existing
 * ROOT-collapse precedent (`public-meeting.controller.ts`'s `!project.parent_uid` check) — a
 * producer that omits the key (`undefined`) or sends an un-collapsed empty string must not
 * silently fall through to `child_project` just because it wrote the wrong falsy value. A caller
 * getting `child_project` for a project it knows is top-level means the producer sent a real,
 * non-empty UID (the un-normalized ROOT case), not that this function is wrong.
 *
 * `parent_uid` is `?: string | null` here, not `Formation`'s plain `string | null`, so the
 * falsy-not-strict-null contract above is modeled honestly: `Formation.parent_uid` itself can
 * never be `undefined`, but this helper deliberately also accepts a caller that omits the key.
 */
export function deriveFormationEntityType(formation: Pick<Formation, 'is_foundation'> & { parent_uid?: string | null }): FormationEntityType {
  if (formation.is_foundation) {
    return 'foundation';
  }
  if (!formation.parent_uid) {
    return 'project';
  }
  return 'child_project';
}

/**
 * Normalizes the `formation` projection's raw `sub_stage` (the full `ProjectStage` string, e.g.
 * `"Formation - Engaged"`) to the canonical {@link FormationSubStage} union (GH-2366). `null` when
 * `rawSubStage` isn't one of the 3 mapped values — including the 5-value `ProjectStage` Formation
 * taxonomy's `Disengaged`/`Confidential` (no queue equivalent) and any non-Formation stage like
 * `Active` — never widen the union or guess; the caller keeps the row and renders `sub_stage_raw`
 * instead (see {@link getFormationQueueStageDisplay}).
 *
 * `Object.hasOwn` (not `rawSubStage in ...` / a bare index), matching `getFormationSubStageLabel`
 * (`project.utils.ts`) — an upstream string that collides with an inherited `Object.prototype`
 * member name (`toString`, `constructor`, ...) must resolve to `null`, not a function off the
 * prototype chain.
 */
export function normalizeFormationSubStage(rawSubStage: string | null | undefined): FormationSubStage | null {
  if (!rawSubStage) {
    return null;
  }
  return Object.hasOwn(UPSTREAM_SUB_STAGE_TO_FORMATION_SUB_STAGE, rawSubStage)
    ? (UPSTREAM_SUB_STAGE_TO_FORMATION_SUB_STAGE as Record<string, FormationSubStage>)[rawSubStage]
    : null;
}

/**
 * `FormationsTableComponent`'s and `MyFormationsCardComponent`'s shared stage-chip resolver
 * (GH-2366). A mapped `subStage` renders the canonical label/severity; `null` (an upstream stage
 * with no queue-taxonomy equivalent) renders `rawSubStage` verbatim in a muted chip rather than an
 * empty pill or an invented label — nothing here decides whether that row belongs in the queue at
 * all (#2328). An empty `rawSubStage` (nothing upstream sent) has nothing honest to echo, so it
 * falls back to an em dash.
 */
export function getFormationQueueStageDisplay(subStage: FormationSubStage | null, rawSubStage: string): { label: string; severity: TagSeverity } {
  if (subStage) {
    return { label: FORMATION_SUB_STAGE_LABELS[subStage], severity: FORMATION_SUB_STAGE_SEVERITY[subStage] };
  }
  return { label: rawSubStage || '—', severity: 'secondary' };
}
