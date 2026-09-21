// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormationActionType, FormationOwnerTeam, FormationTemplateSectionKey } from '../enums/formation.enum';
import type { TagSeverity } from './components.interface';
import { Project } from './project.interface';

/**
 * Formation domain types (GH-2163, epic #1965). Mirrors the object shapes planned for
 * `lfx-v2-formation-service` (#1957) — `formation`, `formation_item`, `activity`,
 * `formation_template` — scoped to Epic 1: no `request` object/SLA tracking (that richer model
 * is #1957/Epic 2), no invites, no Confidential read-guard switch, no application-flow state
 * (`draft`/`submitted`/`withdrawn`) — intake is Epic 2, see #1957.
 *
 * Canonical shared shape reconciling GH-1958 (naming/structure) and GH-1959 (template sub-items,
 * owner-team/action-type vocabularies) — see the GH-2163 issue for the full derivation.
 *
 * These interfaces mirror `lfx-v2-formation-service`'s live response bodies — see
 * `formation.service.ts` for the upstream mapping.
 */

/**
 * Formations queue display taxonomy (queue filters, sub-stage pill) — formations already in
 * flight only. No `proposed`/`withdrawn` here: those were Accept/Decline-era states (Epic 2,
 * #1962). No `activating` member: activating is derived readiness (see {@link Formation.is_activating}),
 * rendered as a separate "Gates cleared" badge (#1958) — never in the Stage column, which would
 * wrongly imply the project is about to flip (Active is set by the formation team in the admin
 * tool, normally on the announcement date).
 */
export type FormationSubStage = 'exploratory' | 'engaged' | 'on_hold';

/** Upstream's `dsl.Enum("live", "completed", "frozen")` (`cmd/formation-api/design/design.go`, `lfx-v2-formation-service`), read via `normalizeFormationLifecycle` (GH-2328). See {@link UpstreamFormationChecklist.lifecycle} for the trust boundary and the deliberate contrast with `sections[].key`'s tolerant typing. */
export type FormationLifecycle = 'live' | 'completed' | 'frozen';

/**
 * What kind of record is in formation — drives the queue's Type column and indentation. Derived,
 * never stored: compute with {@link deriveFormationEntityType} (`formation.utils.ts`) from
 * {@link Formation.is_foundation} and {@link Formation.parent_uid}, don't add a stored field for
 * it (GH-2163 §1, confirmed on #1957 8 Sep — "nothing stored, and we can derive").
 *
 * Outstanding: the derivation is only correct if a top-level project's `parent_uid` reaches the
 * client as `null` rather than the real (hidden, per-environment) root project's UID — see that
 * field's doc comment. Nothing in this repo performs that normalization yet; it lands with the
 * BFF's queue-wiring work, not here.
 */
export type FormationEntityType = 'foundation' | 'child_project' | 'project';

/** A plain user reference — not an Epic 2 "formation lead" record (#1992), which doesn't exist in Epic 1. */
export interface FormationUser {
  username: string;
  name: string;
}

export interface Formation {
  /**
   * Absent on the checklist read (`GET /formations/{project_uid}` doesn't echo the formation's own
   * uid today — raised upstream on #1957/GH-2267 as a one-line additive fix) — present on the queue
   * projection ({@link FormationQueueRow.formation_uid}, copied here on that read path). Nothing in
   * this repo cross-references a checklist-read `Formation` against a queue-read one by uid today,
   * so the absence is safe to leave as-is until the upstream field lands.
   */
  uid?: string;
  /** The project this formation is FOR — not that project's parent; see {@link Formation.parent_uid} for that. */
  parent_project_uid: string;
  parent_project_slug: string;
  parent_project_name: string;
  /** Present only when {@link deriveFormationEntityType} resolves `child_project` — the foundation/project this formation nests under, for the queue's indented display. */
  parent_formation_name?: string;
  /** Derivation input (#1957, GH-2163 §1) — whether {@link Formation.parent_project_uid}'s project is a foundation. Mirrors the upstream project's `is_foundation`. */
  is_foundation: boolean;
  /**
   * Derivation input (#1957, GH-2163 §1) — the UID of {@link Formation.parent_project_uid}'s
   * project's OWN parent (one level further up than `parent_project_uid` itself). Upstream, a
   * project's `parent_uid` is required and non-empty — even a top-level project is parented to
   * the hidden `ROOT` project (`lfx-v2-project-service` `scripts/root-project-setup`), whose UID
   * is a fresh, per-environment UUID that is resolved only server-side (this repo's
   * `persona-detection.service.ts` NATS `PROJECT_SLUG_TO_UID` lookup) and never reaches the
   * client. This field must therefore be `null` here rather than that UID — the producer (the
   * BFF, when it wires the real service) collapses a `ROOT`-parented project's `parent_uid` to
   * `null` before this payload is built. This repo already has the ROOT-collapse precedent, just
   * shaped slightly differently: `resolveParentProject` in `public-meeting.controller.ts`
   * (LFXV2-3266) nulls out a project's *resolved parent object* — `parent?.slug ===
   * ROOT_PROJECT_SLUG ? null : parent` — surfaced as `PublicMeetingProject.parent`, rather than
   * collapsing a raw `parent_uid` string the way this field does; `deriveFormationEntityType`
   * (`formation.utils.ts`) also treats an un-collapsed empty string the same as `null`, since an
   * omitted/blank value is a more likely producer slip than a real ROOT UUID. Nothing in this
   * repo performs the `parent_uid`-collapse normalization yet — nothing here derives
   * `FormationEntityType` from a raw upstream value either. If a caller ever observes a real UID
   * (not `null`/empty) on a top-level project, that normalization is missing or broken, and every
   * foundation-tier formation would silently misderive as `child_project`.
   */
  parent_uid: string | null;
  template_uid: string;
  template_version: number;
  /**
   * Normalized via the same {@link normalizeFormationSubStage} the formations queue uses (GH-2328),
   * from the NATS project record's own `stage` — the checklist read's upstream payload
   * (`UpstreamFormationChecklist`) carries no stage field of its own. `null` when the project's
   * `ProjectStage` has no queue-taxonomy equivalent: the 5-value Formation taxonomy's
   * `Disengaged`/`Confidential`, or a non-Formation stage like `Active`. Never widen
   * {@link FormationSubStage} to cover these — a consumer renders {@link sub_stage_raw} through
   * `getFormationQueueStageDisplay` instead of guessing. Nothing here decides whether such a
   * project belongs on the checklist page at all (#2328 scope item 2).
   */
  sub_stage: FormationSubStage | null;
  /** The project's raw upstream `ProjectStage` string verbatim, before normalization — the only honest thing to render for a project whose {@link sub_stage} is `null` (GH-2328). */
  sub_stage_raw: string;
  /**
   * Normalized via {@link normalizeFormationLifecycle} from `UpstreamFormationChecklist.lifecycle`
   * (GH-2328). `null` means the upstream value did not match a known {@link FormationLifecycle} —
   * fail-closed, the opposite of {@link sub_stage}'s tolerance: an unrecognized `sub_stage` still
   * gates the queue taxonomy loosely, but an unrecognized `lifecycle` must never be treated as
   * `'live'`. Consumers render read-only whenever this is anything but `'live'`, including `null`.
   */
  lifecycle: FormationLifecycle | null;
  /** The checklist's raw upstream `lifecycle` string verbatim — the only honest thing to render (in the read-only banner) for a formation whose {@link lifecycle} is `null` (GH-2328). */
  lifecycle_raw: string;
  /** ISO date. Null until a gating item sets it. */
  announcement_date: string | null;
  /**
   * Taken verbatim from upstream's own `is_activating` (GH-2267 Phase 1) — this repo never
   * re-derives it. Upstream's contract: every gating item `done`, at least one gating item exists,
   * **AND** the project has an announcement date (`cmd/formation-api/design/design.go`,
   * `linuxfoundation/lfx-v2-formation-service`). A gating item in any non-`done` status —
   * `not_started`/`in_progress`/`blocked`/`skipped` — keeps this false.
   *
   * This is the **readiness** half of the two-number model (GH-2329): "can this formation go
   * Active?" — the other half, "is there anything left for a human to do?", is a caller-side fold of
   * `done` *or* `skipped` over `deriveFormationReadinessSummary`'s per-status tally
   * (`packages/shared/src/utils/formation-checklist.utils.ts`; see e.g. `formations-table.component.ts`'s
   * `doneCount`). A formation that has skipped every remaining gating item is checklist-complete by
   * that fold and still not activating — that is the model working as intended, not a divergence to
   * fix by deriving this field client-side.
   */
  is_activating: boolean;
  gating_items_open: number;
  gating_items_total: number;
  /** First not-done gating item's title, precomputed for the queue's "Blocking" column. */
  blocking_item_title: string | null;
  subtitle: string | null;
  /** Absent on the checklist read (`GET /formations/{project_uid}` doesn't return either timestamp) — raised upstream on #1957/GH-2267. */
  created_at?: string;
  updated_at?: string;
}

/**
 * The exact 5-value enum `lfx-v2-formation-service` shipped at tag v0.1.4
 * (`internal/domain/model/status.go`) — `blocked` is the stored value for an item stuck on
 * something external (the UI may word it "waiting on partner", but that's copy, not a stored
 * state). GH-2576 Phase 2 removed the earlier provisional `awaiting_acceptance` 4th state: upstream
 * never shipped it — there is deliberately no state between `in_progress` and `done`, and the rule
 * that an assignee can't close their own item is enforced by the API gateway (a `writer_guard` +
 * `team:formation` membership double-check on `POST .../status`), not by an extra status.
 *
 * Only `done` counts toward readiness — wherever `is_activating` or a gating count is derived,
 * a non-`done` status must not count as complete. `skipped` doesn't count toward readiness either
 * (GH-2329): readiness ("can this formation go Active?") and checklist completion ("is there
 * anything left for a human to do?") are two different questions with two different answers —
 * `done`-only for the former, a caller-side fold of `done` *or* `skipped` for the latter (see e.g.
 * `formations-table.component.ts`'s `doneCount`). See {@link Formation.is_activating} and
 * `deriveFormationReadinessSummary` — the server owns the former; the latter's per-status tally is
 * what callers fold — and never merge the two back into one.
 */
export type FormationItemStatus = 'not_started' | 'in_progress' | 'blocked' | 'done' | 'skipped';

/**
 * Which audience a checklist item concerns, normalized from upstream's `checklist_type`
 * ({@link UpstreamFormationItem.checklist_type} keeps the wire name; the mapped field is named
 * `audience` so it can't be confused with {@link FormationActionType}, a mistake existing fixtures
 * have already made). Display metadata only per the service's rendering contract — the response is
 * never filtered by it and nothing gates on it, so normalization is tolerant like `sub_stage`, NOT
 * fail-closed like `lifecycle`: an unrecognized upstream value maps to `null` and the row simply
 * shows no audience chip (see `normalizeFormationItemAudience`, `formation.utils.ts`).
 */
export type FormationItemAudience = 'internal' | 'external' | 'both';

/**
 * The {@link FormationItemAudience} members that involve people outside the LF (#2774) — the row's
 * globe icon renders for exactly these, and `FORMATION_ITEM_AUDIENCE_TOOLTIPS` is keyed on them.
 * Narrowed by `isFormationItemExternal` (`formation.utils.ts`).
 */
export type FormationItemExternalAudience = Extract<FormationItemAudience, 'external' | 'both'>;

/**
 * One row's action affordance. `request` is a real, working Epic-1 action: files a lightweight
 * request and flips the item to `blocked`, with no SLA/target-team object — that richer `request`
 * type is #1957/Epic 2. `status_only` items never expose how the underlying tooling was set up
 * (manual vs automated) — only Done/pending + an optional link.
 */
// Derived from `FormationActionType` rather than its own literal union — the two must always agree
// (the seeded template's `action` field is `FormationActionType`; a live checklist item's `action`
// is one of these same values), and deriving it removes the need to cast between them.
export type FormationItemAction = `${FormationActionType}`;

export interface FormationSubItem {
  uid: string;
  title: string;
  status: FormationItemStatus;
}

export interface FormationItem {
  uid: string;
  formation_uid: string;
  /**
   * The project this item's formation belongs to. Present because the real service (#1957)
   * addresses an item's write route by `(project_uid, item_key)`, not by `uid` alone — the API
   * gateway's authorization rule reads `project:<uid>` straight off the request path, and an
   * opaque item `uid` would force that check inside the service instead. `uid` remains the
   * durable reference for deep links and activity; `template_item_key` (the service's `item_key`)
   * is stable by contract — a template upgrade only adds items, never renames or resets one.
   */
  project_uid: string;
  template_item_key: string;
  section_key: string;
  section_title: string;
  title: string;
  status: FormationItemStatus;
  /**
   * Only gating items count toward `is_activating` and show the "Required for Active" chip — the
   * agreed 4 Sep vocabulary (#1958) for the chip, the readiness strip, the Me-lens marker and the
   * item-assigned email. "Gates cleared" survives only as the formation-level queue badge.
   */
  is_gating: boolean;
  /** TODO(#1957): narrow once the real service confirms its owner-team vocabulary — values seen from upstream today can fall outside {@link FormationOwnerTeam}'s curated set. */
  owner_team: string | null;
  /** Normalized from upstream's `checklist_type`; `null` when upstream sends an unrecognized or missing value — see {@link FormationItemAudience}. */
  audience: FormationItemAudience | null;
  owner: FormationUser | null;
  due_date: string | null;
  action: FormationItemAction;
  /**
   * Resolved destination for the row's action — the expansion output of the template's
   * {@link FormationTemplateItem.action_link}, substituted once and stored static. Any action
   * kind may have one: a `manual` row still says where the work is done. May be an in-app
   * relative path or an absolute external URL; `null` when the row has no destination. Service-
   * supplied and untrusted: a consumer binding this into `[href]` must scheme-validate an
   * absolute value first (see `isValidUrl` in `packages/shared/src/utils/url.utils.ts`) and route
   * a relative value through the router rather than a raw anchor.
   */
  action_href: string | null;
  detail: string | null;
  notes: string | null;
  /**
   * Single `http`/`https` evidence link, carried straight through from upstream's `evidence_link`
   * (decided on #1957, 9 Sep — see the GH-2267 plan's gap 5). Never a second field; the label ("Evidence")
   * is a display concern owned by the template, not this contract. `null`/missing when the item has none;
   * untrusted service output — a consumer binding this into `[href]` must scheme-validate first (see
   * `isValidUrl` in `packages/shared/src/utils/url.utils.ts`).
   */
  evidence_link: string | null;
  sub_items: FormationSubItem[];
  /** Required and logged when a gating item is skipped. */
  skip_reason: string | null;
  /**
   * The set of write operations the service currently permits on this item (GH-2576) — carried
   * through from upstream's own `available_actions` verbatim. Describes the ITEM, not the caller:
   * two callers reading the same item get an identical list, so this is advisory, not a permission
   * grant — the service still refuses a disallowed action regardless of what this list says. A
   * consumer deriving a UI affordance from it should check for the specific `action` name it cares
   * about (e.g. `'mark_done'`, `'skip'`) and treat an absent/unrecognized one as "don't render this
   * affordance," never throw. `action`/`requires_relation` are deliberately untyped `string` — both
   * vocabularies grow upstream without a BFF release; do not narrow either to a closed union.
   *
   * Phase 1 (GH-2576) only wires up the five status-transition actions this UI already has controls
   * for — `mark_in_progress`, `mark_done`, `mark_blocked`, `skip`, `back_to_not_started` (see
   * `formationItemHasAction`, `packages/shared/src/utils/formation.utils.ts`). The remaining
   * published actions — `assign`, `set_due_date`, `set_note`, `set_evidence_link` — are carried
   * through on this field but not yet consulted by any gate; those controls keep their pre-existing,
   * `available_actions`-independent gating (`canWrite`/`readOnly`). Don't assume full coverage from
   * this field's presence alone.
   */
  available_actions: FormationItemAvailableAction[];
  created_at: string;
  updated_at: string;
  /**
   * Optimistic-locking token (#1957/GH-2267 gap 1). Echoed on every read, sent back as `If-Match`
   * on every mutation; a stale value 412s upstream (mapped to `PreconditionFailedError` in the BFF)
   * rather than silently overwriting a concurrent edit. Always populated — the mapper echoes the
   * upstream `version` verbatim.
   */
  version: number;
}

/**
 * One entry of {@link FormationItem.available_actions} / {@link UpstreamFormationItem.available_actions}
 * (GH-2576). `action` and `requires_relation` are untyped `string` deliberately — see
 * {@link FormationItem.available_actions}'s doc comment for why neither is a closed union.
 */
export interface FormationItemAvailableAction {
  action: string;
  requires_reason: boolean;
  requires_relation: string;
}

/**
 * Distinguishes a write response whose `item` reflects a full post-write remap (project slug and
 * section titles resolved) from one where that remap itself failed after the write had already
 * persisted upstream — mirrors {@link FormationActivityHistoryState}'s pattern: a degraded `item`
 * must never look like a normal one to a caller deciding whether to trust its cosmetic fields
 * (`action_href`, `section_title`), while `version`/`etag` — all a caller needs for its next write's
 * `If-Match` — are unaffected either way, sourced directly from the write's own response rather than
 * from this remap (PR #2613, Cursor Bugbot: a remap failure must not turn an already-successful write
 * into an error the client retries with a now-stale `If-Match`).
 */
export type FormationItemWriteState = 'complete' | 'stale';

/** One write route's result (GH-2576 Phase 2) — the updated item plus the `ETag` it now carries, ready to use as the `If-Match` on the caller's next write against the same item. */
export interface FormationItemWriteResult {
  item: FormationItem;
  etag: string | null;
  /** See {@link FormationItemWriteState}'s doc comment. */
  item_state: FormationItemWriteState;
}

/**
 * The subset of {@link FormationItemAvailableAction.action} values this UI actually consults
 * (`formationItemHasAction`, `packages/shared/src/utils/formation.utils.ts`) — a closed union here
 * is safe and worthwhile even though the wire field itself stays open `string`: a typo in one of
 * these five literals is a compile error, where a typo'd argument against a bare `string` parameter
 * would silently and permanently resolve to "action not available." Upstream's own vocabulary is
 * larger than this (also publishes `assign`, `set_due_date`, `set_note`, `set_evidence_link` — see
 * {@link FormationItem.available_actions}'s doc comment for what Phase 1 does and doesn't consume)
 * and will keep growing; add to this union only when a new UI control starts consulting a new
 * action name, never as a blanket sync with upstream's list.
 */
export type FormationKnownAvailableAction = 'mark_in_progress' | 'mark_done' | 'mark_blocked' | 'skip' | 'back_to_not_started';

/**
 * The real set upstream emits (GH-2372; read from `linuxfoundation/lfx-v2-formation-service`'s Go
 * source at `beaa6371ff94a1ae01f3e624922897cb34ee199b`, not inferred from this repo's prior type,
 * which modeled only 3 of these 14 and 4 members that don't exist — see the GH-2372 PR for the
 * full comparison table). `action` is an unconstrained `dsl.String` on the wire with no enum, so
 * an unrecognized value is always possible — see {@link FormationActivity.action_raw}.
 *
 * Notable gaps versus what the previous type implied: there is no `item_completed` or
 * `item_skipped` — both arrive as `status_changed` with `after.status` telling you which; no
 * `note_added` (it's `note_changed`); no `item_requested` (never emitted).
 */
export type FormationActivityAction =
  | 'status_changed'
  | 'assignee_changed'
  | 'evidence_link_changed'
  | 'due_date_changed'
  | 'note_changed'
  | 'sub_items_changed'
  | 'skip_reason_changed'
  | 'item_updated'
  | 'item_accepted'
  | 'item_rejected'
  | 'item_reopened'
  | 'platform_check_resolved'
  | 'template_expanded'
  | 'template_upgraded';

/**
 * One entry from `GET /formations/{project_uid}/activity`, mapped onto the wire (GH-2372). Field
 * names follow the upstream wire (`ulid`→`uid`, `item_uid`→`formation_item_uid`, `at`→`created_at`)
 * rather than the previous type's invented ones (`type`, `message`, `metadata`) — there is no
 * `message` on the wire; the display string is built at render time by
 * {@link FormationActivityAction} + {@link before}/{@link after} (see `getFormationActivityDisplay`,
 * `formation.utils.ts`).
 */
export interface FormationActivity {
  /** Upstream `ulid` — time-ordered primary key and the feed's own paging cursor. */
  uid: string;
  /** Upstream `item_uid`. `null` for a formation-level entry (`template_expanded`/`template_upgraded`). */
  formation_item_uid: string | null;
  /**
   * `null` when upstream's `action` isn't one of the 14 modeled values — never coerced into a
   * plausible neighbour (the GH-2366/GH-2328 defect class). Always read alongside {@link action_raw}.
   */
  action: FormationActivityAction | null;
  /** Upstream `action`, verbatim — rendered as-is when {@link action} is `null`. */
  action_raw: string;
  set_by: 'user' | 'system';
  /** Upstream sends a bare username (or the literal `"system"`); `name` mirrors it, same precedent as `mapLiveItem`'s `owner`. */
  actor: FormationUser;
  /**
   * Upstream's redacted `{status, assignee}` summary — the only structured payload the feed
   * carries. For `due_date_changed`/`note_changed`/`evidence_link_changed`/`sub_items_changed`/
   * `skip_reason_changed` the actual old/new value is NOT in the feed at all: `before` and `after`
   * are identical for those actions.
   */
  before: { status: string | null; assignee: string | null } | null;
  after: { status: string | null; assignee: string | null } | null;
  /** Upstream `at`, RFC3339. */
  created_at: string;
}

/** Wire shape of one `GET /formations/{project_uid}/activity` entry, pre-mapping (GH-2372). */
export interface UpstreamFormationActivityEntry {
  ulid: string;
  item_uid?: string | null;
  actor: string;
  set_by: 'user' | 'system';
  /** Unconstrained upstream — deliberately `string`, never the canonical union. */
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  at: string;
}

/** Response body for `GET /formations/{project_uid}/activity`. */
export interface UpstreamFormationActivityPage {
  entries: UpstreamFormationActivityEntry[];
  /** Always present; `''` means last page — a consumer must not test only for `undefined`. */
  next_cursor: string;
}

/**
 * A sub-step of a formation checklist template item (e.g. the chat workspace's IT setup steps).
 * Nests one level only — a `FormationTemplateSubItem` has no `sub_items` of its own.
 */
export interface FormationTemplateSubItem {
  key: string;
  title: string;
  owner_team: FormationOwnerTeam;
}

/**
 * Structure only for Epic 1 — no template editor (#1994/Epic 2). One seeded template (#1959)
 * applied automatically when a formation is created.
 */
export interface FormationTemplate {
  uid: string;
  /**
   * Bump whenever items/gates/sections change. Persisted formations (#1957) reference
   * (uid, version) to reconstruct the exact checklist they were created against, so a content
   * edit without a version bump makes two different checklists indistinguishable.
   */
  version: number;
  name: string;
  sections: FormationTemplateSection[];
}

export interface FormationTemplateSection {
  /**
   * `FormationTemplateSectionKey` covers every section the seeded static template defines, but a
   * live checklist's `sections[]` (`UpstreamFormationChecklist.sections[].key`) comes from the
   * upstream template revision, not this enum — an upstream section this BFF doesn't recognize yet
   * is a display gap (falls into `FORMATION_ORPHAN_SECTION`, see `groupFormationItemsBySection`),
   * not a type error, so this stays the wider `string` rather than forcing an unsound
   * `as unknown as` cast at either call site.
   */
  key: FormationTemplateSectionKey | string;
  title: string;
  items: FormationTemplateItem[];
}

export interface FormationTemplateItem {
  key: string;
  title: string;
  /** True only on legal/entity items that gate the formation's transition to Active. */
  is_gating: boolean;
  owner_team: FormationOwnerTeam;
  /** `'status_only'` IS the status-only signal — there is no separate boolean to keep in sync with it. */
  action: FormationActionType;
  /**
   * Optional template-defined destination for the row's action. Resolved ONCE at expansion with
   * `{{project.uid}}` / `{{project.slug}}` substitution and stored static on the resulting
   * {@link FormationItem.action_href} — the runtime field is the resolved value, this one is the
   * unresolved template. In-app relative paths (`/project/{{project.uid}}/committees/new`) or
   * absolute external URLs. Absent means the row's action has no destination.
   * TODO(#1957): the formation service owns the substitution; nothing in this repo resolves
   * `{{…}}` today.
   */
  action_link?: string;
  sub_items?: FormationTemplateSubItem[];
}

/**
 * The four fields `FormationCardComponent` renders, resolved from whichever of its two sources is
 * active — the `formation` input (a loaded {@link FormationChecklistResponse}) or
 * `ProjectContextService`. Collapsing them into one object is what guarantees the card never mixes
 * the two: on the foundation drill-down the context service describes the *parent foundation*, so
 * a per-field fallback would show the foundation's slug beside a child project's checklist (#2719).
 */
export interface FormationCardView {
  /** Project uid, used only for the card's own `auditor`/SFID lookups. `null` suppresses them. */
  uid: string | null;
  slug: string;
  /** Output of `getFormationSubStageLabel`; `null` when the stage isn't a Formation sub-stage. */
  subStageLabel: string | null;
  /** Output of `formatAnnouncementDateLabel` — already a display string, `'Not set'` when absent. */
  announcementLabel: string;
}

/** Response body for `GET /api/projects/:slug/formation`. */
export interface FormationChecklistResponse {
  formation: Formation;
  template: FormationTemplate | null;
  items: FormationItem[];
  /**
   * Whether the caller holds `project.writer` on THIS checklist's project — the flag the gateway's
   * `writer_guard` gates `POST .../assignment` (assignee/due date) on, and half of the
   * `POST .../status` guard (GH-2694). Resolved per caller by the BFF via the single-project
   * access check (never a batch check — LFXV2-2823) and fail-closed: an access-check failure
   * reports `false`, so the drawer renders those controls read-only rather than offering a write
   * that can only 403. Needed on the response because the checklist renders in two hosts —
   * `/project/formation` and the foundation formations drill-down — and in the drill-down the
   * project context describes the foundation, not this checklist's own project, so no
   * context-derived writer flag can stand in for it.
   */
  can_write: boolean;
  /**
   * Whether the caller may move item statuses on this checklist — the advisory mirror of the
   * gateway's `set_item_status` rule (`ruleset.yaml`, `lfx-v2-formation-service` v0.1.4), which
   * requires BOTH `writer_guard` on the project AND `member` on `team:formation` (GH-2705; the
   * pair is what stops an assignee closing their own item). {@link can_write} covers the writer
   * half only; this flag is `can_write` ∧ the team-membership check (via the access-check
   * service's `team`/`member` support, `FORMATION_TEAM_NAME`), fail-closed like `can_write`, so
   * status controls are hidden rather than offered to a caller the gateway deterministically
   * 403s. Advisory only — the gateway still enforces; the BFF adds no write guard of its own.
   */
  can_set_status: boolean;
}

/**
 * The queue's server-side counts — the four stat tiles and the per-`sub_stage` filter-pill
 * counts. Every count here is taken over the same pre-filter set (`total`'s), never over the rows a
 * stage pill or search has narrowed, so the strip can't disagree with itself once a filter is
 * active. `foundations` and `projects` name the {@link FormationEntityType} derived taxonomy —
 * `projects` counts both `child_project` and `project` rows (i.e. every non-foundation), so a plain
 * top-level project isn't dropped from the breakdown while still counting toward `total`. Named
 * `projects`, not `child_projects`, because the taxonomy now deliberately distinguishes a plain
 * top-level `project` from a `child_project` and this aggregate deliberately includes both.
 */
export type FormationQueueTiles = Record<FormationSubStage, number> & {
  total: number;
  foundations: number;
  projects: number;
  /**
   * Rows whose every gating item is done (`gates_cleared`) — the "Ready to activate" tile. Counted
   * here rather than client-side over the served rows, which are already filtered: that was how the
   * tile used to read "0" the moment an Engaged pill hid the one ready Exploratory row.
   */
  ready: number;
  /** Rows with at least one item in `blocked` status (`blocked_item_titles.length > 0`) — the "Blocked" tile. */
  blocked: number;
  /** Sum of `blocked_item_titles.length` across every row — the "Blocked" tile's "N blocked items" sub-line. */
  blocked_items: number;
  /**
   * Rows whose upstream `sub_stage` has no {@link FormationSubStage} equivalent (GH-2366) —
   * `"Formation - Confidential"` or any other unrecognized value. `"Active"` and
   * `"Formation - Disengaged"` no longer reach this count: since GH-2584 the queue lists only
   * formations still in progress, and both have left. Included in `total` but in none of the three
   * sub-stage counts, so `total` can legitimately exceed `exploratory + engaged + on_hold`; that
   * gap is this count. See {@link FormationQueueRow.sub_stage}.
   *
   * Nothing renders this — GH-2584 removed the tile line that did, because "outside formation
   * stages" described no row once the queue had excluded everything outside. It is kept because a
   * non-zero value means a new `Formation - *` sub-stage has appeared upstream that the tiles and
   * the stage filter cannot represent, which the BFF logs at DEBUG (`formation.service.ts`).
   */
  unmapped: number;
};

/**
 * One queue row as the BFF serves it — **not** the `formation` indexed document verbatim, and not
 * a subset of {@link Formation}. The raw indexer shape is {@link UpstreamFormationQueueRow}
 * (`internal/infrastructure/nats/indexer_publisher.go`'s hand-written allowlist); this type is what
 * `getFormationsQueueLive` (`formation.service.ts`) produces after normalizing `sub_stage` via
 * `normalizeFormationSubStage` (GH-2366) — see {@link sub_stage} / {@link sub_stage_raw}. The
 * indexer doesn't publish `template_uid`/`template_version`/`created_at`/`updated_at`/
 * `gating_items_open`/`gating_items_total` (#1957/GH-2267 gap 2, raised upstream), so this is a
 * deliberately separate shape rather than `Partial<Formation>` or an extension of it.
 * `gates_cleared` replaces the checklist read's open/total pair — the queue's gating column reads
 * off `gates_cleared` + `progress`, not `gating_items_open`/`gating_items_total`.
 */
export interface FormationQueueRow {
  formation_uid: string;
  project_uid: string;
  project_name: string;
  project_slug: string;
  is_foundation: boolean;
  /** Same ROOT-collapse contract as {@link Formation.parent_uid} — `null` for a top-level project. */
  parent_uid: string | null;
  /**
   * Normalized via `normalizeFormationSubStage` (GH-2366) from the upstream projection's full
   * `ProjectStage` string — see {@link sub_stage_raw} for that original value. `null` when the
   * upstream stage has no {@link FormationSubStage} equivalent (e.g. `"Formation - Confidential"`).
   *
   * An unmapped row still appears in the queue, rendered verbatim, but in none of the three stage
   * tiles/filters — see {@link FormationQueueTiles.unmapped}. Being unmapped is never itself a
   * reason to drop a row: since GH-2584 presence is decided by the formation service's published
   * lifecycle, which is why `"Active"` and `"Formation - Disengaged"` are no longer examples here
   * despite also normalizing to `null` — they are gone before this field is consulted.
   */
  sub_stage: FormationSubStage | null;
  /** The upstream projection's `sub_stage` value verbatim, before normalization — the only honest thing to render for a row whose {@link sub_stage} is `null` (GH-2366). */
  sub_stage_raw: string;
  /**
   * Normalized via {@link normalizeFormationLifecycle} from the projection's own `lifecycle`
   * tag — `live` while forming, `completed` on Active, `frozen` on Archived or Disengaged
   * (`model.LifecycleForStage`). Since GH-2584 this decides queue membership, so it is always
   * `'live'` on a served row: `getFormationsQueueLive` filters on it after normalizing, and
   * fails closed, dropping anything that did not match a known {@link FormationLifecycle}.
   *
   * Typed as the union rather than the raw string deliberately: it was a bare `string` until
   * PR #2767, and an off-taxonomy value is a silently dropped row now that presence turns on
   * this field, not the cosmetic slip it was before.
   *
   * That alone would not have caught the `'formation'` value the queue fixtures carried, which
   * is what prompted the change — `apps/lfx-one/tsconfig.json` includes the `src` tree only, so
   * nothing under `e2e` is typechecked and a fixture can still hold any string. The union
   * constrains the served contract and every consumer under `src`; the fixtures need that
   * tsconfig gap closed, which is left to its own change.
   */
  lifecycle: FormationLifecycle | null;
  /** Every gating item done — the projection's own boolean, not derived client-side (unlike {@link Formation.is_activating}, which is #1957-computed on the checklist read but not yet mirrored into the indexed document). */
  gates_cleared: boolean;
  is_activating: boolean;
  /** ISO date (date-only, YYYY-MM-DD) — the indexer projection's own copy of the same value {@link Formation.announcement_date} carries; `null` until a gating item sets it. */
  announcement_date: string | null;
  /**
   * Per-status item counts published by the indexer (`indexer_publisher.go`'s `projectionData`
   * always emits all six {@link FormationItemStatus} keys). Typed `Partial<...>` rather than a
   * required-keys `Record`, and defaulted defensively where consumed (`formation.service.ts`'s
   * `??` default, `formations-table.component.ts`'s `?? 0`), as protection against a malformed
   * document rather than an open contract question — the confirmed six-key shape doesn't need an
   * unsound cast to express a `{}` fallback.
   */
  progress: Partial<Record<FormationItemStatus, number>>;
  blocked_item_titles: string[];
  /** Bare usernames, as published by the indexer (`internal/domain/port/ports.go`'s `Assignees []string`) — not `FormationUser` objects. */
  assignees: string[];
}

/**
 * Raw `formation` indexed-document shape, before `sub_stage` normalization (GH-2366) — the
 * `/query/resources` response payload's item shape. Identical to {@link FormationQueueRow} except
 * `sub_stage` is the upstream's own full `ProjectStage` string rather than the normalized
 * {@link FormationSubStage}, and there is no separate `sub_stage_raw` (this *is* the raw value).
 * Server-only: `getFormationsQueueLive` (`formation.service.ts`) is the sole consumer, mapping this
 * onto `FormationQueueRow` via `normalizeFormationSubStage` before anything else in the repo sees it.
 */
export type UpstreamFormationQueueRow = Omit<FormationQueueRow, 'sub_stage' | 'sub_stage_raw' | 'lifecycle'> & {
  sub_stage: string;
  /** The projection's `lifecycle` verbatim — untrusted, so a bare string here and a {@link FormationLifecycle} only after `normalizeQueueRow`. */
  lifecycle: string;
};

/** Response body for `GET /api/formations`. */
export interface FormationsQueueResponse {
  tiles: FormationQueueTiles;
  rows: FormationQueueRow[];
}

/**
 * Raw item shape from `GET /formations/{project_uid}` / a mutation response — one entry of
 * {@link UpstreamFormationChecklist}'s `items[]`. Server-only (`formation-mapper.helper.ts` maps it
 * onto {@link FormationItem}), kept here per this package's "no local interface in apps/lfx-one"
 * convention rather than declared next to its sole consumer.
 */
export interface UpstreamFormationItem {
  uid: string;
  item_key: string;
  section_key: string;
  position: number;
  title: string;
  owner_team?: string | null;
  gate: boolean;
  requires_writer: boolean;
  status_source: 'manual' | 'platform';
  is_required: boolean;
  checklist_type: string;
  platform_check?: { min_count: number; resource_type: string } | null;
  action_link?: string | null;
  evidence_link?: string | null;
  status: FormationItemStatus;
  assignee?: string | null;
  due_date?: string | null;
  note?: string | null;
  skip_reason?: string | null;
  resolved_ref?: { type: string; uid: string } | null;
  sub_items?: { key: string; title: string; status: FormationItemStatus }[];
  /** GH-2576. Confirmed present on every item on the deployed service (never missing) — optional here anyway, matching this interface's general defensiveness about trusting upstream verbatim. */
  available_actions?: FormationItemAvailableAction[];
  version: number;
}

/** Raw response shape from `GET /formations/{project_uid}?v=1` — the GH-2267 plan's gap 3 (no `formation_uid`/timestamps). */
export interface UpstreamFormationChecklist {
  project_uid: string;
  template_uid: string;
  template_version: number;
  /**
   * Upstream's `dsl.Enum("live", "completed", "frozen")` (`cmd/formation-api/design/design.go`).
   * Trusted from `proxyRequest`'s unchecked cast, same as every other field on this wire shape — a
   * 4th upstream enum value would violate this type without a runtime guard. Read by
   * `mapUpstreamFormationChecklist` via `normalizeFormationLifecycle` (GH-2328), which is
   * deliberately the OPPOSITE of `sections[].key`'s tolerance: that field is typed
   * `FormationTemplateSectionKey | string` so an unrecognized section falls into
   * `FORMATION_ORPHAN_SECTION` and is still admitted, but an unrecognized `lifecycle` must never be
   * treated as `'live'` — `normalizeFormationLifecycle` maps anything it doesn't recognize to
   * `null`, and `null` renders read-only exactly like `'completed'`/`'frozen'`. Fail open here would
   * mean a future 4th upstream value silently re-opens a checklist that should stay locked.
   */
  lifecycle: 'live' | 'completed' | 'frozen';
  sections: { key: string; title: string; position: number }[];
  items: UpstreamFormationItem[];
  is_activating: boolean;
}

/** Everything `mapUpstreamFormationItem` needs beyond the raw item itself — none of it is on the wire. */
export interface FormationItemMapContext {
  formationUid: string;
  projectUid: string;
  projectSlug: string;
  /**
   * Per-project section titles sourced from a `GET /formations/{project_uid}` response
   * (`raw.sections[].title`, keyed by `key`) — takes priority over the seeded template's section
   * title so a renamed section reads consistently across every item row that resolves it, whether
   * from the checklist read itself or a live mutation response mapped afterward (both read from the
   * same per-request cache — see `FormationService.mapLiveItem`'s doc comment). No live-path caller
   * omits it in practice — `mapLiveItem` always looks the cache up first — but it stays optional
   * since a cache miss (a future call site that skips the `getFormationItemOrThrow` pre-read) still
   * falls back to the seeded template map rather than throwing.
   */
  sectionTitles?: Map<string, string>;
}

/**
 * Everything `mapUpstreamFormationChecklist` needs beyond the raw checklist itself — the project
 * record (for name/slug/stage, plus `legal_entity_type`/`funding`/`funding_model` so
 * `computeIsFoundation` can classify it — `is_foundation` is independent of hierarchy depth, so it
 * must not be derived from `parentUid`), the already ROOT-collapsed `parent_uid` (see the
 * `root-project.helper.ts` collapse helpers in `apps/lfx-one`), the mapped items (to derive gating
 * counts from), and the `announcement_date` (no upstream source on the checklist read itself — see
 * `FormationService.getProjectFormation`'s doc comment for where it comes from instead).
 */
export interface FormationChecklistMapContext {
  project: Pick<Project, 'slug' | 'name' | 'stage' | 'legal_entity_type' | 'funding' | 'funding_model'>;
  parentUid: string | null;
  announcementDate: string | null;
  items: FormationItem[];
}

/**
 * Raw `formation_item` indexed-document shape (`/query/resources?type=formation_item`) — one
 * document per checklist item, published by `lfx-v2-formation-service` v0.1.2 (GH-1956, #2334).
 * Per the service's `docs/indexer-contract.md`: `note`/`skip_reason`/`resolved_ref`/`evidence_link`
 * are deliberately excluded (drawer-only detail, read from the checklist directly), and so is
 * `version` — "a document this old could only hand out a stale one; read the item to act on it."
 * There is no `action` field either: like the checklist read, it is derived from `item_key` via
 * `deriveItemAction` (`formation-mapper.helper.ts`), not carried on the wire. `lifecycle` is the
 * owning checklist's (`live | completed | frozen`), included so a query result can be filtered to
 * live checklists without a second read. Server-only — `getMyFormationWork` (`formation.service.ts`)
 * is the sole consumer, mapping this onto {@link MyFormationItemRow}.
 */
export interface UpstreamFormationItemRow {
  object_id: string;
  formation_uid: string;
  project_uid: string;
  project_name: string;
  project_slug: string;
  lifecycle: string;
  item_key: string;
  title: string;
  status_source: 'manual' | 'platform';
  status: FormationItemStatus;
  gate: boolean;
  requires_writer: boolean;
  due_date?: string | null;
  owner_team?: string | null;
  action_link?: string | null;
  sub_items?: { key: string; title: string; status: FormationItemStatus }[];
  assignee?: string;
}

/**
 * One checklist item assigned to the caller, across every project they can read (GH-1956). Built
 * from a `type=formation_item` query against the item index `lfx-v2-formation-service` v0.1.2
 * shipped (#2334) — see {@link UpstreamFormationItemRow} for the raw document this maps 1:1 onto,
 * via `FormationService.getMyFormationWork`.
 */
export interface MyFormationItemRow {
  item_uid: string;
  /** The write address, together with {@link MyFormationItemRow.project_uid} — see `FormationItem.template_item_key`'s doc comment. */
  template_item_key: string;
  project_uid: string;
  project_slug: string;
  project_name: string;
  title: string;
  /** Never `'done'` | `'skipped'` — filtered upstream of this shape by `isAssignedItemOpen`. */
  status: FormationItemStatus;
  /** Drives the "required for Active" segment of the Pending Actions row's meta line. */
  is_gating: boolean;
  /** DATE-ONLY string, rendered as the row's "due <Mon D>" segment. */
  due_date: string | null;
  /**
   * Whether the caller has `writer` on {@link MyFormationItemRow.project_uid}, resolved per project
   * from the same read that supplies the stage gate on `items[]`. No Me-lens UI reads it since
   * #2732 — the row's one action navigates to the checklist unconditionally, and the checklist's
   * own response carries the authoritative pair — so it stays only for parity with
   * `FormationChecklistResponse`; dropping it is #2735.
   */
  can_write: boolean;
  /**
   * {@link can_write} ∧ `team:formation` membership (GH-2705) — the full pair the gateway's
   * `set_item_status` rule checks, carried so the wire shape mirrors `FormationChecklistResponse`.
   * No Me-lens UI reads it since #2732 (the row navigates to the checklist, whose own response
   * carries the authoritative pair); it stays so a future consumer fails closed rather than
   * inheriting the GH-2705 defect. The membership half is caller-scoped, so within one response it
   * is the same for every row; it still lives per-row because `can_write` (the project half)
   * varies per row.
   */
  can_set_status: boolean;
}

/**
 * One live formation the caller holds a direct project grant on (a formation invite — GH-1956's
 * original "My formations" definition, satisfied via the query service's `filter_grants=direct`,
 * #2795) or has at least one assigned item on. Built server-side by `getMyFormationWork`
 * (`formation.service.ts`): the caller's direct-grant Formation-stage projects plus the
 * `type=formation_item` index read that produces {@link MyFormationItemRow}, joined against the
 * {@link FormationQueueRow} aggregates of that assigned-or-invited set. An invited-only row carries
 * all-zero `assigned_*` buckets — there is deliberately no "invited" flag or label, since the grant
 * alone can't say more than that truthfully (see the ticket's third comment).
 */
export interface MyFormationSummary {
  formation_uid: string;
  project_uid: string;
  project_slug: string;
  project_name: string;
  /** Normalized via `normalizeFormationSubStage` (GH-2366/GH-1956) — see {@link sub_stage_raw} for the verbatim upstream value when this is `null`. A consumer renders through `getFormationQueueStageDisplay`, mirroring {@link FormationQueueRow.sub_stage}, rather than indexing a label map directly off this field. */
  sub_stage: FormationSubStage | null;
  /** The `formation` projection's `sub_stage` value verbatim, before normalization — the only honest thing to render for a row whose {@link sub_stage} is `null` (GH-1956, same gap #2370/#2373 already fixed on the queue and checklist paths). */
  sub_stage_raw: string;
  announcement_date: string | null;
  /**
   * The "My formations" subtitle buckets — see `formatMyFormationSubtitle`. GH-2576 Phase 2
   * collapsed the earlier `assigned_with_team` bucket (built for the retired `awaiting_acceptance`
   * status) into this one — every non-terminal status (`not_started`/`in_progress`/`blocked`) is
   * still the assignee's own open work under the real 5-value status model, so there is nothing
   * left for a separate "with formation team" count to track.
   */
  assigned_to_do: number;
  assigned_done: number;
  /** Skipped is kept out of `assigned_done` — skipping is an escape hatch for a gate the project can't complete, not completion. */
  assigned_skipped: number;
  /**
   * `done` + `skipped` together (PR #2444 review) — mirrors the queue's own `doneCount` convention
   * (`formations-table.component.ts`): a checklist is resolved once every item is done or skipped,
   * so a fully-skipped formation reads "3 of 3", not "0 of 3". Distinct from `assigned_skipped`
   * above, which deliberately keeps skipped out of `assigned_done` — that pair answers "what does
   * the caller's own work look like", this one answers "is the checklist as a whole resolved".
   */
  items_done: number;
  items_total: number;
  /**
   * Readiness, not checklist completion (GH-2329) — counts only `status === 'done'`, same rule as
   * {@link Formation.is_activating}. A skipped gating item is not done and stays outstanding here
   * even though it counts toward `assigned_done`'s sibling `assigned_skipped` bucket above.
   * Currently always `0` — the `formation` projection has no per-gating-item breakdown, only the
   * boolean {@link FormationQueueRow.gates_cleared} (#1957/GH-2267 gap 2, raised upstream and not
   * yet published). Not fabricated by re-reading the full live checklist per formation, which
   * would reintroduce the per-project fan-out this index exists to eliminate.
   */
  gating_done: number;
  gating_total: number;
  blocking_item_title: string | null;
}

/**
 * Distinguishes why `getMyFormationWork`'s response looks the way it does (GH-1956) — mirrors
 * {@link FormationActivityHistoryState}'s pattern: a genuinely-empty result must never look like a
 * failed one. `'complete'`: both the item-assignment query and the formation-aggregate query
 * succeeded — `formations`/`items` may still be empty, meaning the caller has nothing assigned.
 * `'partial'`: the item query succeeded (so `items` is trustworthy) but the formation-aggregate
 * query failed, or was missing a row for at least one formation the caller has an assigned item on
 * — such a formation is dropped from `formations` rather than fabricated. `'unavailable'`: the item
 * query itself failed — nothing in this response can be trusted, and both arrays are forced empty.
 */
export type MyFormationWorkState = 'complete' | 'partial' | 'unavailable';

/** Response body for `GET /api/user/formation-work` (GH-1956, Me lens only). */
export interface MyFormationWorkResponse {
  formations: MyFormationSummary[];
  items: MyFormationItemRow[];
  state: MyFormationWorkState;
}

/**
 * `MyFormationSummary` decorated with pre-derived display fields for the My Formations page
 * (`my-formations.component.ts`, built by `decorateMyFormation` in `formation-me.utils.ts`) —
 * mirrors `DecoratedPendingAction` in `components.interface.ts`. Templates may only read
 * signals/computed values, never call a method, so `subtitle`/`progressPercent`/`announcementLabel`
 * must be computed once per row up front rather than via template-called functions.
 */
export interface DecoratedMyFormation extends MyFormationSummary {
  subtitle: string;
  progressPercent: number;
  announcementLabel: string | null;
  /** `getFormationQueueStageDisplay(sub_stage, sub_stage_raw)`'s label — mirrors `FormationTableRow.stageLabel` (GH-1956, same #2370/#2373 gap fixed here). */
  stageLabel: string;
  stageSeverity: TagSeverity;
}
