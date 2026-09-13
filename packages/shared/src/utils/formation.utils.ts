// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FORMATION_ACTIVITY_ACTION_LABELS,
  FORMATION_ITEM_STATUS_LABELS,
  FORMATION_SUB_STAGE_LABELS,
  FORMATION_SUB_STAGE_SEVERITY,
  UPSTREAM_SUB_STAGE_TO_FORMATION_SUB_STAGE,
} from '../constants/formation.constants';
import type { TagSeverity } from '../interfaces/components.interface';
import type { Formation, FormationActivity, FormationActivityAction, FormationEntityType, FormationItemStatus, FormationSubStage } from '../interfaces/formation.interface';

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
 * `FormationsTableComponent`'s stage-chip resolver (GH-2366). A mapped `subStage` renders the
 * canonical label/severity; `null` (an upstream stage with no queue-taxonomy equivalent) renders
 * `rawSubStage` **verbatim** in a muted chip — deliberately not run through `getFormationSubStageLabel`
 * or any other canonicalizer, so an off-taxonomy row reads visibly foreign rather than blending in
 * with a mapped row's `·`-separated label. Nothing here decides whether that row belongs in the
 * queue at all (#2328). An empty `rawSubStage` (nothing upstream sent) has nothing honest to echo,
 * so it falls back to an em dash.
 *
 * `MyFormationsCardComponent` does not call this yet — it still indexes
 * `FORMATION_SUB_STAGE_LABELS`/`FORMATION_SUB_STAGE_SEVERITY` directly off `MyFormationSummary.sub_stage`
 * (`my-formations-card.component.html`), which is latent only because `getMyFormationWork` returns
 * an empty payload today (`formation.service.ts`). If that method is ever wired to the same
 * `formation` projection, it will reproduce this exact bug and should normalize through
 * {@link normalizeFormationSubStage} and call this resolver too — see #2328.
 */
export function getFormationQueueStageDisplay(subStage: FormationSubStage | null, rawSubStage: string): { label: string; severity: TagSeverity } {
  if (subStage) {
    return { label: FORMATION_SUB_STAGE_LABELS[subStage], severity: FORMATION_SUB_STAGE_SEVERITY[subStage] };
  }
  return { label: rawSubStage || '—', severity: 'secondary' };
}

/**
 * Upstream's `action` is an unconstrained `dsl.String` with no enum on the wire (GH-2372) — an
 * unrecognized value is always possible, and must resolve to `null` here rather than the nearest
 * plausible member (the GH-2366/GH-2328 defect class this repo has hit twice already). Same
 * `Object.hasOwn` guard as {@link normalizeFormationSubStage}, for the same prototype-collision
 * reason.
 */
export function normalizeFormationActivityAction(rawAction: string | null | undefined): FormationActivityAction | null {
  if (!rawAction) {
    return null;
  }
  return Object.hasOwn(FORMATION_ACTIVITY_ACTION_LABELS, rawAction) ? (rawAction as FormationActivityAction) : null;
}

function statusDetailValue(status: string | null): string {
  if (!status) {
    return 'Unassigned';
  }
  return Object.hasOwn(FORMATION_ITEM_STATUS_LABELS, status) ? FORMATION_ITEM_STATUS_LABELS[status as FormationItemStatus] : status;
}

/**
 * `FormationItemDrawerComponent`'s History-panel row resolver (GH-2372). `summary` reads after the
 * actor's name (`"{{ actor.name }} {{ summary }}"`); `detail` is a second, optional line.
 *
 * Upstream's `before`/`after` carry only a redacted `{status, assignee}` snapshot — for every
 * action other than the ones listed below, the actual old/new value (a due date, a note's text, a
 * link, a sub-item list, a skip reason) **is not in the feed at all**, so `detail` is `null` there
 * rather than a fabricated guess.
 */
export function getFormationActivityDisplay(entry: FormationActivity): { summary: string; detail: string | null } {
  // Off-taxonomy action: the raw wire value, verbatim — never coerced into a mapped label (same
  // rule as getFormationQueueStageDisplay's unmapped-substage branch).
  if (!entry.action) {
    return { summary: entry.action_raw || '—', detail: null };
  }

  const summary = FORMATION_ACTIVITY_ACTION_LABELS[entry.action];

  switch (entry.action) {
    case 'status_changed':
    case 'item_accepted':
    case 'item_rejected':
    case 'item_reopened':
    case 'platform_check_resolved': {
      if (!entry.before || !entry.after) return { summary, detail: null };
      return { summary, detail: `${statusDetailValue(entry.before.status)} → ${statusDetailValue(entry.after.status)}` };
    }
    case 'assignee_changed': {
      if (!entry.before || !entry.after) return { summary, detail: null };
      return { summary, detail: `${entry.before.assignee || 'Unassigned'} → ${entry.after.assignee || 'Unassigned'}` };
    }
    // Formation-level entries: upstream's `after` carries item counts, not a status/assignee pair
    // — surfacing that shape reliably needs its own upstream contract read, which this ticket is
    // explicitly scoped away from (item-drawer History only). No detail line for now.
    case 'template_expanded':
    case 'template_upgraded':
      return { summary, detail: null };
    default:
      // evidence_link_changed, due_date_changed, note_changed, sub_items_changed,
      // skip_reason_changed, item_updated — the changed value isn't in the feed at all.
      return { summary, detail: null };
  }
}
