// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FORMATION_ACTIVITY_ACTION_LABELS,
  FORMATION_ITEM_STATUS_LABELS,
  FORMATION_OWNER_TEAM_LABELS,
  FORMATION_SUB_STAGE_LABELS,
  FORMATION_SUB_STAGE_SEVERITY,
  UPSTREAM_SUB_STAGE_TO_FORMATION_SUB_STAGE,
} from '../constants/formation.constants';
import type { TagSeverity } from '../interfaces/components.interface';
import type {
  Formation,
  FormationActivity,
  FormationActivityAction,
  FormationEntityType,
  FormationItem,
  FormationItemAudience,
  FormationItemStatus,
  FormationKnownAvailableAction,
  FormationLifecycle,
  FormationSubStage,
} from '../interfaces/formation.interface';
import { formatTag } from './string.utils';

/** The exact {@link FormationLifecycle} members — the fail-closed match set for {@link normalizeFormationLifecycle}. */
const FORMATION_LIFECYCLE_VALUES: ReadonlySet<string> = new Set<FormationLifecycle>(['live', 'completed', 'frozen']);

/** The exact {@link FormationItemAudience} members — the tolerant match set for {@link normalizeFormationItemAudience}. */
const FORMATION_ITEM_AUDIENCE_VALUES: ReadonlySet<string> = new Set<FormationItemAudience>(['internal', 'external', 'both']);

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
 * Normalizes `UpstreamFormationChecklist.lifecycle` to the canonical {@link FormationLifecycle}
 * union (GH-2328). `null` when `rawLifecycle` isn't exactly one of the 3 known values — this is
 * deliberately the OPPOSITE of {@link normalizeFormationSubStage}'s tolerance: an unrecognized
 * `sub_stage` still lets the row render (loosely, via `sub_stage_raw`), but an unrecognized
 * `lifecycle` must never be silently treated as `'live'`. `null` here means "render read-only",
 * exactly like `'completed'`/`'frozen'` — see {@link isFormationLifecycleLive}.
 *
 * `Object.hasOwn`-style membership via a `Set`, not a truthy/falsy fallthrough — an empty string or
 * any off-taxonomy value must resolve to `null`, never to the nearest plausible member.
 */
export function normalizeFormationLifecycle(rawLifecycle: string | null | undefined): FormationLifecycle | null {
  if (!rawLifecycle || !FORMATION_LIFECYCLE_VALUES.has(rawLifecycle)) {
    return null;
  }
  return rawLifecycle as FormationLifecycle;
}

/**
 * Normalizes `UpstreamFormationItem.checklist_type` to the canonical {@link FormationItemAudience}
 * union (#2689). `null` for anything off-taxonomy — deliberately tolerant like
 * {@link normalizeFormationSubStage}, NOT fail-closed like {@link normalizeFormationLifecycle}:
 * audience is display metadata only (the service never filters a response by it and nothing gates
 * on it), so an unrecognized value just means "no audience chip", never a behavior downgrade.
 */
export function normalizeFormationItemAudience(rawAudience: string | null | undefined): FormationItemAudience | null {
  if (!rawAudience || !FORMATION_ITEM_AUDIENCE_VALUES.has(rawAudience)) {
    return null;
  }
  return rawAudience as FormationItemAudience;
}

/**
 * `FormationChecklistRowComponent`'s owner-team chip label resolver (#2689): the curated
 * {@link FORMATION_OWNER_TEAM_LABELS} first (generic title-casing gets acronyms wrong — `it` must
 * read "IT", not "It"), then `formatTag` for the off-enum values upstream can send (see
 * `FormationItem.owner_team`'s TODO(#1957) — e.g. `PMO` passes through unchanged, `legal_review` →
 * "Legal Review"). `Object.hasOwn`, not a bare index, for the same prototype-collision reason as
 * {@link normalizeFormationSubStage}.
 */
export function formatFormationOwnerTeam(team: string): string {
  return Object.hasOwn(FORMATION_OWNER_TEAM_LABELS, team) ? FORMATION_OWNER_TEAM_LABELS[team as keyof typeof FORMATION_OWNER_TEAM_LABELS] : formatTag(team);
}

/**
 * The single fail-closed "may this formation be mutated" check (GH-2328) — both the server's
 * `requireLiveFormation` gate and the client's read-only render call this instead of each writing
 * their own `=== 'live'` comparison, so the two can't drift. Written as an explicit `'live'` check,
 * never as "is this `completed`/`frozen`", so `null` (unrecognized) falls into the same read-only
 * bucket as the two known terminal values rather than needing its own branch.
 */
export function isFormationLifecycleLive(lifecycle: FormationLifecycle | null): boolean {
  return lifecycle === 'live';
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
 * `MyFormationsCardComponent` also calls this (GH-1956) — `getMyFormationWork`'s formation-aggregate
 * query reads the same `formation` projection `FormationsTableComponent` does, normalized through
 * {@link normalizeFormationSubStage} in `formation.service.ts` before either consumer sees a row, so
 * the same unmapped-stage handling applies to both surfaces rather than each guessing independently.
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
    return 'No status';
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

/**
 * Whether `item.available_actions` currently includes `action` (GH-2576) — the affordance-gating
 * check every UI control derives its enabled/disabled state from, replacing the deleted
 * `FormationItem.can_complete` boolean. Advisory only: `available_actions` describes the item, not
 * the caller (two viewers get an identical list — see the field's own doc comment), so this is a
 * hint for what the item's current state permits, not a caller-permission check. The service still
 * refuses a disallowed write regardless of what this returns `true` for.
 *
 * Known Phase 1 gap, confirmed via two-round review against the deployed service's transition graph
 * (GH-2576): for every one of the five actions this UI consults (`mark_in_progress`, `mark_done`,
 * `mark_blocked`, `skip`, `back_to_not_started`), the caller-scoped relation upstream actually
 * requires is `formation_team_member`, which has no frontend signal. Availability is per-status, not
 * universal — upstream does not publish all five together for every status (a `done` item, for
 * example, offers only `back_to_not_started` and `mark_in_progress` among them). The accurate
 * invariant is narrower: each gated control's corresponding action is published in the statuses
 * where that control currently renders, which is why this check still resolves `true` in every
 * reachable UI state. There is today no live scenario in which this function's result differs from a
 * hard-coded `true` for those five actions — the disabled path only activates once a future
 * caller-scoped signal (or an upstream item-state distinction this UI doesn't yet know about) makes
 * it possible to differ. Kept wired rather than removed for exactly that forward-compatibility; see
 * the call sites' `[disabled]` bindings, which deliberately carry no "why disabled" copy since that
 * state cannot occur today. Closing the underlying gap needs a `formation_team_member` signal on the
 * frontend, tracked as Phase 2 follow-up work.
 */
export function formationItemHasAction(item: Pick<FormationItem, 'available_actions'>, action: FormationKnownAvailableAction): boolean {
  return item.available_actions.some((entry) => entry.action === action);
}
