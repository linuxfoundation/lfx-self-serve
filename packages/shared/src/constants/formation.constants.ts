// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormationOwnerTeam } from '../enums/formation.enum';
import { ProjectStage } from '../enums/project-stage.enum';
import type { TagSeverity } from '../interfaces/components.interface';
import type { FilterPillOption } from '../interfaces/dashboard-metric.interface';
import type {
  FormationAnnouncementTiming,
  FormationDrawerData,
  FormationItemStatusGlyph,
  FormationLinkRowActionConfig,
  FormationProgressRingSize,
  FormationRowActionConfig,
  FormationSubItemMarker,
} from '../interfaces/formation-checklist.interface';
import type {
  FormationActivityAction,
  FormationEntityType,
  FormationItemAudience,
  FormationItemAvailableAction,
  FormationItemExternalAudience,
  FormationItemStatus,
  FormationQueueTiles,
  FormationsQueueResponse,
  FormationSubStage,
} from '../interfaces/formation.interface';

/**
 * Display labels for the canonical {@link FormationSubStage} union (GH-2163) — the stage chip and
 * stage-filter pills on both formation list surfaces (the Formations queue and My Formations).
 * Short form deliberately: both pages are already titled "Formations", so the upstream
 * `"Formation - Engaged"` prefix repeated on every row and pill was noise, not information. This
 * is the one label map for that union; it does not cover `ProjectStage`'s separate 5-value
 * Formation taxonomy (which includes `Disengaged` and `Confidential`, neither a `FormationSubStage`
 * member, and backs `isFormationStage`/`getFormationSubStageLabel` in `project.utils.ts`) — that
 * map is project-domain data and is named distinctly to avoid colliding with this one.
 */
export const FORMATION_SUB_STAGE_LABELS = {
  exploratory: 'Exploratory',
  engaged: 'Engaged',
  on_hold: 'On hold',
} as const satisfies Record<FormationSubStage, string>;

/**
 * `FormationsTableComponent`'s stage chip severities, keyed by queue sub-stage — three distinct
 * tones, rendered as dot chips: early conversations read as informational, active formation work
 * carries the brand accent, and a parked formation reads as a prompt (it is neither ready nor
 * moving). An unmapped upstream stage renders `secondary` via `getFormationQueueStageDisplay`.
 */
export const FORMATION_SUB_STAGE_SEVERITY = {
  exploratory: 'info',
  engaged: 'accent',
  on_hold: 'warn',
} as const satisfies Record<FormationSubStage, TagSeverity>;

/** Queue filter-pill order (`All` is derived, not listed) — formations already in flight only. */
export const FORMATION_QUEUE_SUB_STAGES: FormationSubStage[] = ['exploratory', 'engaged', 'on_hold'];

/**
 * The Me-lens My Formations page's stage filter pills (#2753): `All` first, then
 * {@link FORMATION_QUEUE_SUB_STAGES} in order, labelled through {@link FORMATION_SUB_STAGE_LABELS}.
 * The foundation Formations queue builds its own pills from that same stage list and label map
 * (`formations-table.component.ts`'s `initStatusTabOptions`) so it can append the server-side
 * counts — the shared pair underneath is what still lands a new sub-stage on both surfaces at once.
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
  ready: 0,
  blocked: 0,
  blocked_items: 0,
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
 * Audience globe tooltip AND accessible name for the external-involving audiences (#2774) —
 * `internal` and `null` render no icon at all (see `isFormationItemExternal`, `formation.utils.ts`).
 * Two consumers: `FormationChecklistRowComponent`'s bare globe, and since #2801 the item drawer's
 * audience chip, which pairs the same globe with its {@link FORMATION_ITEM_AUDIENCE_LABELS} text.
 */
export const FORMATION_ITEM_AUDIENCE_TOOLTIPS = {
  external: "External — involves people outside the Linux Foundation, such as the project's partners.",
  both: "Internal and external — LF staff and the project's partners both take part.",
} as const satisfies Record<FormationItemExternalAudience, string>;

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
 * — shared with its spec so the aria-label can't drift from the rendered tooltip. The row shows a
 * red asterisk only (#2774, the form-field "required" convention); the full "Required for Active"
 * phrase is visible text in the drawer's meta line and the readiness strip's caption, which carries
 * the same asterisk as the legend.
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
 * `FormationItemDrawerComponent`'s header status glyph — the icon inside the tinted round tile
 * ({@link FORMATION_ITEM_STATUS_TILE_CLASSES}) and its text color. Until #2818 this also led every
 * `lfx-formation-sub-item-list` row; the list now draws its own markers from
 * {@link FORMATION_SUB_ITEM_MARKERS}. `colorClass` is spread into `tailwind.config.js`'s safelist
 * because the shared package is outside Tailwind's `content` glob; a color added here is picked up there.
 */
export const FORMATION_ITEM_STATUS_GLYPHS = {
  done: { icon: 'fa-light fa-circle-check', colorClass: 'text-emerald-600' },
  in_progress: { icon: 'fa-light fa-circle-half-stroke', colorClass: 'text-amber-600' },
  blocked: { icon: 'fa-light fa-circle-xmark', colorClass: 'text-red-600' },
  skipped: { icon: 'fa-light fa-forward', colorClass: 'text-gray-400' },
  not_started: { icon: 'fa-light fa-circle', colorClass: 'text-gray-400' },
} as const satisfies Record<FormationItemStatus, FormationItemStatusGlyph>;

/**
 * `FormationItemDrawerComponent`'s header status tile (#2801) — the tinted round well beside the
 * title, paired with {@link FORMATION_ITEM_STATUS_GLYPHS}'s icon for the same status. Spread into
 * `tailwind.config.js`'s safelist (the shared package is outside Tailwind's `content` glob).
 */
export const FORMATION_ITEM_STATUS_TILE_CLASSES = {
  done: 'bg-emerald-50 text-emerald-600',
  in_progress: 'bg-amber-50 text-amber-600',
  blocked: 'bg-red-50 text-red-600',
  skipped: 'bg-gray-100 text-gray-500',
  not_started: 'bg-gray-100 text-gray-500',
} as const satisfies Record<FormationItemStatus, string>;

/**
 * `lfx-formation-sub-item-list`'s per-status row treatment (#2818) — a 20px round marker that is a
 * miniature of the drawer's header tile, the title's tone and the status label's visibility.
 * `done` is the only filled marker so the eye finds finished work; every open status is a ring
 * (amber for in progress, red for blocked, dashed for skipped, gray for not started). The label is
 * `sr-only` where the marker already says it (done, not started) and visible text otherwise, so a
 * list of untouched sub-items no longer repeats "Not started" on every line. The hollow ring is
 * the seam for #2775's checkbox toggle: that control replaces the marker in place without a visual
 * change. Spread into `tailwind.config.js`'s safelist (the shared package is outside Tailwind's
 * `content` glob).
 */
export const FORMATION_SUB_ITEM_MARKERS = {
  done: { icon: 'fa-solid fa-check', markerClass: 'bg-emerald-600 text-white', titleClass: 'text-gray-500', labelClass: 'sr-only' },
  in_progress: { icon: null, markerClass: 'border-2 border-amber-500', titleClass: 'text-gray-700', labelClass: 'text-xs text-amber-700' },
  blocked: { icon: null, markerClass: 'border-2 border-red-500', titleClass: 'text-gray-700', labelClass: 'text-xs text-red-600' },
  skipped: { icon: null, markerClass: 'border-2 border-dashed border-gray-300', titleClass: 'text-gray-400', labelClass: 'text-xs text-gray-500' },
  not_started: { icon: null, markerClass: 'border-2 border-gray-300', titleClass: 'text-gray-700', labelClass: 'sr-only' },
} as const satisfies Record<FormationItemStatus, FormationSubItemMarker>;

/**
 * `lfx-formation-progress-ring`'s outer size per {@link FormationProgressRingSize} (#2818) — `sm`
 * sits inline in the checklist row's "N of M sub-items done" trigger, `md` leads the drawer's
 * sub-items summary. Spread into `tailwind.config.js`'s safelist (the shared package is outside
 * Tailwind's `content` glob).
 */
export const FORMATION_PROGRESS_RING_SIZE_CLASSES = {
  sm: 'w-3.5 h-3.5',
  md: 'w-6 h-6',
} as const satisfies Record<FormationProgressRingSize, string>;

/**
 * `FormationItemDrawerComponent`'s Activity timeline (#2801) shows a relative time ("2 hr ago") for
 * entries younger than this window and a short absolute date for anything older — "612 days ago" is
 * arithmetic, not information. The `<time>` element's `title` always carries the exact timestamp.
 */
export const FORMATION_ACTIVITY_RELATIVE_TIME_WINDOW_MS = 7 * 86_400_000;

/**
 * The checklist row's grid template per panel-width tier (#2774). Container-query variants
 * (`@2xl`/`@5xl` from Tailwind's container-queries plugin; each section panel is the `@container`)
 * rather than viewport breakpoints, because what decides whether the columns fit is the width left
 * beside the nav rail and the page sidebar, not the viewport — a 1440px viewport leaves the panel
 * ~720px. `compact` (panel ≥ 42rem): status | title | actions on one line, with the team/assignee/
 * due meta on a second line under the title. `full` (panel ≥ 64rem): one column per cell, and
 * `FormationChecklistSectionComponent`'s header captions bind the same template so they sit over
 * the columns they label by construction. Fixed tracks: status 9rem, team 7rem, assignee 8rem, due
 * 6rem, actions 9.5rem ("View details" plus the overflow button). Spread into `tailwind.config.js`'s
 * safelist (the shared package is outside Tailwind's `content` glob).
 */
export const FORMATION_CHECKLIST_GRID_CLASSES = {
  compact: '@2xl:grid-cols-[9rem_minmax(0,1fr)_9.5rem]',
  full: '@5xl:grid-cols-[9rem_minmax(0,1fr)_7rem_8rem_6rem_9.5rem]',
} as const;

/**
 * `FormationsTableComponent`'s progress-bar segment order (`buildFormationProgressSegments`) as a
 * rank per status — resolved work first, open work last, so the bar reads left to right as "how
 * far along". A rank map rather than an ordered array so it is exhaustiveness-checked like its
 * siblings: a status added to {@link FormationItemStatus} fails the build here instead of silently
 * producing a bar whose widths sum below 100% and a summary whose buckets don't add up to its own
 * item count. Only non-zero buckets render, so a fully-`not_started` row is one gray track.
 */
export const FORMATION_PROGRESS_SEGMENT_RANK = {
  done: 0,
  in_progress: 1,
  blocked: 2,
  skipped: 3,
  not_started: 4,
} as const satisfies Record<FormationItemStatus, number>;

/**
 * `FormationsTableComponent`'s countdown-line colour per {@link FormationAnnouncementTiming}. A
 * passed or same-day date is a prompt (amber); an upcoming one is plain; `needed` is amber for the
 * reason that timing exists — the missing date is now all that stands between the formation and
 * Active. Assembled outside the app's Tailwind `content` globs, so it is spread into the safelist.
 */
export const FORMATION_ANNOUNCEMENT_TIMING_CLASS = {
  past: 'text-amber-600',
  today: 'text-amber-600',
  upcoming: 'text-gray-500',
  unset: 'text-gray-400',
  needed: 'text-amber-600',
} as const satisfies Record<FormationAnnouncementTiming, string>;

/** The Announcement cell's second line for a `needed` timing (see {@link FormationAnnouncementTiming}). */
export const FORMATION_ANNOUNCEMENT_NEEDED_LABEL = 'Needed to activate';

/**
 * `FormationsTableComponent`'s rows per page before the paginator appears, and the sizes it offers.
 * Every row is already on the client (the BFF materialises the whole queue), and a foundation's
 * queue can run past a hundred rows (GH-2699), so paging is a rendering courtesy, not a fetch size.
 */
export const FORMATION_QUEUE_PAGE_SIZE = 25;
export const FORMATION_QUEUE_PAGE_SIZE_OPTIONS: number[] = [FORMATION_QUEUE_PAGE_SIZE, 50, 100];

/** The queue name cell's sub-line per derived {@link FormationEntityType} (`deriveFormationEntityType`) — the same taxonomy the "N foundations · N projects" tile counts. */
export const FORMATION_ENTITY_TYPE_LABELS = {
  foundation: 'Foundation',
  project: 'Project',
  child_project: 'Child project',
} as const satisfies Record<FormationEntityType, string>;

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
