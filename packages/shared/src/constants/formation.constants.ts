// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormationOwnerTeam } from '../enums/formation.enum';
import { ProjectStage } from '../enums/project-stage.enum';
import type { TagSeverity } from '../interfaces/components.interface';
import type { FilterPillOption } from '../interfaces/dashboard-metric.interface';
import type { FormationDrawerData, FormationLinkRowActionConfig, FormationRowActionConfig } from '../interfaces/formation-checklist.interface';
import type {
  FormationActivityAction,
  FormationItemAudience,
  FormationItemAvailableAction,
  FormationItemStatus,
  FormationQueueTiles,
  FormationsQueueResponse,
  FormationSubStage,
} from '../interfaces/formation.interface';

/**
 * Display labels for the canonical {@link FormationSubStage} union (GH-2163) — the Formations
 * queue's stage column and stage-filter pills. This is the one label map for that union; it does
 * not cover `ProjectStage`'s separate 5-value Formation taxonomy (which includes `Disengaged` and
 * `Confidential`, neither a `FormationSubStage` member, and backs `isFormationStage`/
 * `getFormationSubStageLabel` in `project.utils.ts`) — that map is project-domain data and is named
 * distinctly to avoid colliding with this one.
 */
export const FORMATION_SUB_STAGE_LABELS = {
  exploratory: 'Formation · Exploratory',
  engaged: 'Formation · Engaged',
  on_hold: 'Formation · On Hold',
} as const satisfies Record<FormationSubStage, string>;

/** `FormationsTableComponent`'s stage chip severities, keyed by queue sub-stage. */
export const FORMATION_SUB_STAGE_SEVERITY = {
  exploratory: 'accent',
  engaged: 'accent',
  on_hold: 'accent',
} as const satisfies Record<FormationSubStage, TagSeverity>;

/** Queue filter-pill order (`All` is derived, not listed) — formations already in flight only. */
export const FORMATION_QUEUE_SUB_STAGES: FormationSubStage[] = ['exploratory', 'engaged', 'on_hold'];

/**
 * The stage filter pills both formation list surfaces render — the foundation Formations queue
 * (`formations-table.component.ts`) and the Me-lens My Formations page (#2753): `All` first, then
 * {@link FORMATION_QUEUE_SUB_STAGES} in order, labelled through {@link FORMATION_SUB_STAGE_LABELS}.
 * Shared so a new sub-stage lands on both surfaces at once.
 */
export const FORMATION_STAGE_TAB_OPTIONS: FilterPillOption[] = [
  { id: 'all', label: 'All' },
  ...FORMATION_QUEUE_SUB_STAGES.map((stage) => ({ id: stage, label: FORMATION_SUB_STAGE_LABELS[stage] })),
];

/**
 * Upstream projection `sub_stage` → the canonical {@link FormationSubStage} union (GH-2366). The
 * indexer publishes the full `ProjectStage` string (`"Formation - Engaged"`), not this union's
 * short key, so every queue-row consumer must go through `normalizeFormationSubStage`
 * (`formation.utils.ts`) rather than trusting the projection's `sub_stage` field as-is.
 *
 * Partial by design: `ProjectStage` has 5 Formation-prefixed values, this union has 3. `Disengaged`
 * and `Confidential` have no queue-taxonomy equivalent, and non-Formation stages (`Active`,
 * `Archived`, `Prospect`) aren't formations at all — none of those belong here, so they aren't in
 * this map and normalize to `null`. See `normalizeFormationSubStage`'s doc comment for what a
 * `null` result means to the queue (GH-2366, GH-2328).
 */
export const UPSTREAM_SUB_STAGE_TO_FORMATION_SUB_STAGE = {
  [ProjectStage.FormationExploratory]: 'exploratory',
  [ProjectStage.FormationEngaged]: 'engaged',
  [ProjectStage.FormationOnHold]: 'on_hold',
} as const satisfies Partial<Record<ProjectStage, FormationSubStage>>;

/**
 * The single Epic-1 seeded template's UID (#1959 owns the real seed content). Shared with the
 * e2e fixtures so they can't drift out of sync with the template `formation-mapper.helper.ts`
 * looks up by this key.
 */
export const SEEDED_FORMATION_TEMPLATE_UID = 'formation-template-seed-v1';

/**
 * Fallback section key/title for a formation item whose `section_key` matches none of the
 * current template's sections — exactly what a template section rename produces for items still
 * carrying the old key. `formation-checklist-section.component.ts` buckets such items here instead
 * of silently dropping them.
 */
export const FORMATION_ORPHAN_SECTION = { key: '__orphan__', title: 'Other' } as const;

/**
 * `FormationItemDrawerComponent`'s sentinel for "closed" or "not yet loaded" — a factory, not a
 * shared object, for the same reason as `createEmptyFormationsQueueResponse`: `history` backs both
 * a `toSignal` `initialValue` and a `catchError` fallback, which would otherwise alias one mutable
 * array across every call site.
 */
export function createEmptyFormationDrawerData(): FormationDrawerData {
  return { item: null, history: [], history_state: 'complete' };
}

/**
 * Display verb phrases for {@link FormationActivityAction}, read after the actor's name (GH-2372) —
 * e.g. "Jane changed the status". Total (unlike `UPSTREAM_SUB_STAGE_TO_FORMATION_SUB_STAGE`'s
 * deliberate `Partial`): the action union is closed here, matching `FORMATION_ITEM_STATUS_LABELS`'s
 * pattern. An off-taxonomy `action` never reaches this map — `getFormationActivityDisplay` falls
 * back to `action_raw` verbatim instead of a lookup miss.
 */
export const FORMATION_ACTIVITY_ACTION_LABELS = {
  status_changed: 'changed the status',
  assignee_changed: 'changed the assignee',
  evidence_link_changed: 'updated the evidence link',
  due_date_changed: 'changed the due date',
  note_changed: 'updated the note',
  sub_items_changed: 'updated the sub-items',
  skip_reason_changed: 'updated the skip reason',
  item_updated: 'updated this item',
  item_accepted: 'accepted this item',
  item_rejected: 'rejected this item',
  item_reopened: 'reopened this item',
  platform_check_resolved: 'resolved this item automatically',
  template_expanded: 'created the checklist from a template',
  template_upgraded: 'upgraded the checklist template',
} as const satisfies Record<FormationActivityAction, string>;

/**
 * `FormationChecklistRowComponent`'s `provisionable`/`request` action-button config, keyed by
 * action kind — typed via `satisfies` so a bad `severity` literal fails the build instead of
 * silently rendering an unstyled button, the way an untyped `*ngTemplateOutlet` context would.
 */
export const FORMATION_GATED_ROW_ACTIONS = {
  provisionable: { testidPrefix: 'formation-checklist-row-provision', label: 'Set up', severity: 'primary', outlined: false },
  request: { testidPrefix: 'formation-checklist-row-request', label: 'Request', severity: 'secondary', outlined: true },
} as const satisfies Record<'provisionable' | 'request', FormationRowActionConfig>;

/** `FormationChecklistRowComponent`'s `link`/`status_only` action testid prefixes, keyed by action kind — same typed-at-the-definition-site rationale as `FORMATION_GATED_ROW_ACTIONS`. */
export const FORMATION_LINK_ROW_ACTIONS = {
  link: { testidPrefix: 'formation-checklist-row-link' },
  status_only: { testidPrefix: 'formation-checklist-row-status-only' },
} as const satisfies Record<'link' | 'status_only', FormationLinkRowActionConfig>;

/** `FormationsQueueComponent`'s zeroed tile counts — the `catchError`/pre-fetch fallback for `FormationQueueTiles`. */
export const FORMATION_EMPTY_QUEUE_TILES = {
  exploratory: 0,
  engaged: 0,
  on_hold: 0,
  total: 0,
  foundations: 0,
  projects: 0,
  unmapped: 0,
} as const satisfies FormationQueueTiles;

/**
 * `FormationsQueueComponent`'s sentinel for "not yet loaded" or a failed fetch — a factory, not a
 * shared object, so its `toSignal` `initialValue` use and its `catchError` fallback use each get
 * their own `tiles`/`rows`, never one singleton two call sites could mutate through each other.
 */
export function createEmptyFormationsQueueResponse(): FormationsQueueResponse {
  return { tiles: { ...FORMATION_EMPTY_QUEUE_TILES }, rows: [] };
}

/** `FormationChecklistRowComponent`'s status chip labels, mirroring `POLL_STATUS_LABELS`'s pattern. */
export const FORMATION_ITEM_STATUS_LABELS = {
  done: 'Done',
  in_progress: 'In progress',
  blocked: 'Blocked',
  not_started: 'Not started',
  skipped: 'Skipped',
} as const satisfies Record<FormationItemStatus, string>;

/** `FormationChecklistRowComponent`'s status chip severities, mirroring `POLL_STATUS_SEVERITY`'s pattern. */
export const FORMATION_ITEM_STATUS_SEVERITY = {
  done: 'success',
  in_progress: 'warn',
  blocked: 'danger',
  not_started: 'secondary',
  skipped: 'secondary',
} as const satisfies Record<FormationItemStatus, TagSeverity>;

/** `FormationChecklistRowComponent`'s audience chip labels, keyed by the normalized {@link FormationItemAudience}. */
export const FORMATION_ITEM_AUDIENCE_LABELS = {
  internal: 'Internal',
  external: 'External',
  both: 'Internal + External',
} as const satisfies Record<FormationItemAudience, string>;

/**
 * Display labels for {@link FormationOwnerTeam}'s curated members. Consumers go through
 * `formatFormationOwnerTeam` (`formation.utils.ts`), which falls back to `formatTag` for the
 * off-enum values upstream can send (see `FormationItem.owner_team`'s TODO(#1957)). Curated rather
 * than derived because generic title-casing gets acronyms wrong (`it` → "It", not "IT").
 */
export const FORMATION_OWNER_TEAM_LABELS = {
  [FormationOwnerTeam.FORMATION]: 'Formation',
  [FormationOwnerTeam.BRAND_COUNSEL]: 'Brand Counsel',
  [FormationOwnerTeam.COMMUNITY]: 'Community',
  [FormationOwnerTeam.IT]: 'IT',
  [FormationOwnerTeam.MARKETING]: 'Marketing',
  [FormationOwnerTeam.PRODUCT_OPS]: 'Product Ops',
  [FormationOwnerTeam.PRODUCT]: 'Product',
} as const satisfies Record<`${FormationOwnerTeam}`, string>;

/**
 * The row-level gating indicator's tooltip/accessible-name copy (`FormationChecklistRowComponent`)
 * — shared with its spec so the aria-label can't drift from the rendered tooltip. The row shows an
 * icon-only indicator; the full-text "Required for Active" tag remains in the drawer and the
 * readiness strip owns the gating summary copy.
 */
export const FORMATION_GATING_ICON_TOOLTIP = 'Required for Active — must be done before the project can go Active';

/** `FormationReadinessStripComponent`'s per-segment fill color, keyed by item status. Not `done` must never read green. */
export const FORMATION_ITEM_SEGMENT_COLORS = {
  done: 'bg-emerald-600',
  in_progress: 'bg-amber-500',
  blocked: 'bg-red-500',
  not_started: 'bg-gray-200',
  skipped: 'bg-gray-400',
} as const satisfies Record<FormationItemStatus, string>;

/**
 * Every action the deployed `lfx-v2-formation-service` publishes across every status (GH-2576,
 * observed live against a `not_started` item plus `back_to_not_started` — the one status action a
 * `not_started` item itself never offers, since there's no self-transition — see the GH-2576
 * Section 0 comment). Test-only: the "nothing is gated" fixture for `available_actions`, standing in
 * for the deleted `can_complete: true` default. Not used by production code — real items carry
 * whatever subset upstream's own `AvailableActionsFor(status, lifecycle)` computes for their actual
 * status, which this factory does not attempt to model. A function, not a shared array constant, so
 * each fixture gets its own instance — nothing here is meant to be mutated, but nothing stops a
 * future test from doing so, and a shared reference would leak that mutation across every consumer.
 */
export function createFormationAllAvailableActions(): FormationItemAvailableAction[] {
  return [
    { action: 'mark_in_progress', requires_reason: false, requires_relation: 'formation_team_member' },
    { action: 'mark_done', requires_reason: false, requires_relation: 'formation_team_member' },
    { action: 'mark_blocked', requires_reason: true, requires_relation: 'formation_team_member' },
    { action: 'skip', requires_reason: true, requires_relation: 'formation_team_member' },
    { action: 'back_to_not_started', requires_reason: true, requires_relation: 'formation_team_member' },
    { action: 'assign', requires_reason: false, requires_relation: 'writer' },
    { action: 'set_due_date', requires_reason: false, requires_relation: 'writer' },
    { action: 'set_note', requires_reason: false, requires_relation: 'auditor' },
    { action: 'set_evidence_link', requires_reason: false, requires_relation: 'auditor' },
  ];
}

/**
 * `FormationChecklistRowComponent`'s status-menu label/icon per target — one lookup instead of a
 * nested ternary chain. No `FORMATION_ALLOWED_STATUS_TARGETS`-style transition graph alongside this:
 * `available_actions` (upstream's own per-item, per-status answer, see `formationItemHasAction`) is
 * the single source of truth for which of these targets to offer/gate — a hand-maintained closed
 * graph would drift from `internal/domain/model/status.go` and can't represent an action upstream
 * adds that this repo doesn't know about yet.
 */
export const FORMATION_STATUS_MENU_ITEM_DISPLAY = {
  not_started: { label: 'Back to not started', icon: 'fa-light fa-rotate-left' },
  in_progress: { label: 'Mark in progress', icon: 'fa-light fa-spinner' },
  blocked: { label: 'Mark blocked…', icon: 'fa-light fa-hand' },
  done: { label: 'Mark done', icon: 'fa-light fa-check' },
  skipped: { label: 'Skip with reason', icon: 'fa-light fa-forward' },
} as const satisfies Record<FormationItemStatus, { label: string; icon: string }>;

/**
 * The OpenFGA team whose `member`s may move a checklist item's status (GH-2705). Mirrors
 * `lfx-v2-formation-service`'s chart default (`values.yaml` `app.formationTeamName: "formation"`,
 * tag v0.1.4) — the chart documents it as "the same value in every environment, so it is a real
 * default here rather than a per-environment identifier". The gateway's `set_item_status` rule
 * checks `member` on `team:<this>` (ANDed with `writer_guard` on the project); the BFF checks the
 * same relation via the access-check service to compute `FormationChecklistResponse.can_set_status`,
 * so the UI can stop offering status controls to callers the gateway will deterministically 403.
 */
export const FORMATION_TEAM_NAME = 'formation';

/** The project-page formation checklist route; `?project=<slug>` names the project (GH-1958). */
export const FORMATION_CHECKLIST_PATH = '/project/formation';

/**
 * Query param that deep-links to one checklist item (#2732): `?item=<template_item_key>` — the
 * item's stable key, never its uid. Honoured by `FormationChecklistSectionComponent` on both hosts
 * (`/project/formation` and `/foundation/formations/:projectSlug`), which opens that item's panel
 * once the checklist has loaded and then strips the param from the URL, so a refresh or Back never
 * re-opens it. `buildFormationPendingActionView` (`formation-me.utils.ts`) builds the link for the
 * Me-lens pending-action row; the same shape is what the formation-service item-assigned email can
 * append (#2573, #2616, #1961).
 */
export const FORMATION_ITEM_QUERY_PARAM = 'item';
