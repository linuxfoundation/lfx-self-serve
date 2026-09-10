// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormationActionType, FormationOwnerTeam, FormationTemplateSectionKey } from '../enums/formation.enum';

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
 * TODO(#1957): every runtime interface here is shaped to match the real service's eventual
 * response bodies as closely as fixtures allow, so wiring the real service is a data-source swap
 * in `formation.service.ts`, not a type change. See `formation-backend.helper.ts` for the swap
 * point.
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
  sub_stage: FormationSubStage;
  /** ISO date. Null until a gating item sets it. */
  announcement_date: string | null;
  /**
   * Derived: every gating item `done` (and at least one gating item exists). An `awaiting_acceptance`
   * gating item does not count as `done`, so it keeps this false. TODO(#1957): backend-derived once real.
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
 * `blocked` is the stored value for an item stuck on something external — the UI may word it
 * "waiting on partner", but that's copy, not a stored state. `awaiting_acceptance` is a 4 Sep
 * product decision: an assignee marking their item complete doesn't close it — it stays on their
 * Pending Actions until the formation team accepts it (`in_progress` understates that, `done`
 * overstates it and would let it count toward readiness). TODO(#1957): `awaiting_acceptance` is
 * provisional — the architecture lead hasn't reviewed the name.
 *
 * Only `done` counts toward readiness — wherever `is_activating` or a gating count is derived,
 * `awaiting_acceptance` must not count as complete.
 */
export type FormationItemStatus = 'not_started' | 'in_progress' | 'blocked' | 'awaiting_acceptance' | 'done' | 'skipped';

/**
 * One row's action affordance. `request` is a real, working Epic-1 action (fixture-only: files a
 * lightweight request and flips the item to `blocked`, no SLA/target-team object — that richer
 * `request` type is #1957/Epic 2). `status_only` items never expose how the underlying tooling was
 * set up (manual vs automated) — only Done/pending + an optional link.
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
  /** TODO(#1957): narrow once the real service confirms its owner-team vocabulary — fixture values today include labels (e.g. `'PMO'`) outside {@link FormationOwnerTeam}'s curated set. */
  owner_team: string | null;
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
  links: FormationItemLink[];
  sub_items: FormationSubItem[];
  /** Required and logged when a gating item is skipped. */
  skip_reason: string | null;
  /**
   * Whether the caller may complete this row — response-only, enrichment output. There is no
   * `gate_writer` relation: gating is a property of the item, not the person. The guard is the
   * project write permission plus this item's `is_gating` flag, checked service-side.
   * TODO(#1957): fabricated today by `FormationItemAccessService.canComplete`; swap for the real
   * service-side check once it ships.
   */
  can_complete: boolean;
  created_at: string;
  updated_at: string;
  /**
   * Optimistic-locking token (#1957/GH-2267 gap 1). Echoed on every read, sent back as `If-Match`
   * on every mutation; a stale value 412s upstream (mapped to `PreconditionFailedError` in the BFF)
   * rather than silently overwriting a concurrent edit. Always populated — the fixture generator
   * seeds `1` for every item, and the live mapper echoes the upstream `version` verbatim.
   */
  version: number;
}

export interface FormationItemLink {
  label: string;
  href: string;
}

export type FormationActivityType =
  | 'item_completed'
  | 'item_skipped'
  | 'item_reopened'
  | 'item_requested'
  | 'note_added'
  | 'assignee_changed'
  | 'due_date_changed';

export interface FormationActivity {
  uid: string;
  formation_uid: string;
  /** Always item-scoped today — every {@link FormationActivityType} is an item-level action. */
  formation_item_uid: string | null;
  type: FormationActivityType;
  actor: FormationUser;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
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
  key: FormationTemplateSectionKey;
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

/** Response body for `GET /api/projects/:slug/formation`. */
export interface FormationChecklistResponse {
  formation: Formation;
  template: FormationTemplate | null;
  items: FormationItem[];
  data_source: 'fixture' | 'live';
}

/**
 * Per-`sub_stage` counts for the queue's filter pills. `foundations` and `projects` name the
 * {@link FormationEntityType} derived taxonomy — `projects` counts both `child_project` and
 * `project` rows (i.e. every non-foundation), so a plain top-level project isn't dropped from the
 * breakdown while still counting toward `total`. Named `projects`, not `child_projects`, because
 * the taxonomy now deliberately distinguishes a plain top-level `project` from a `child_project`
 * and this aggregate deliberately includes both.
 */
export type FormationQueueTiles = Record<FormationSubStage, number> & {
  total: number;
  foundations: number;
  projects: number;
};

/**
 * One queue row, shaped to exactly what the `formation` indexed document carries
 * (`internal/infrastructure/nats/indexer_publisher.go`'s hand-written allowlist) — not a subset of
 * {@link Formation}. The indexer doesn't publish `template_uid`/`template_version`/`created_at`/
 * `updated_at`/`gating_items_open`/`gating_items_total` (#1957/GH-2267 gap 2, raised upstream), so
 * this is a deliberately separate shape rather than `Partial<Formation>` or an extension of it.
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
  sub_stage: FormationSubStage;
  lifecycle: string;
  /** Every gating item done — the projection's own boolean, not derived client-side (unlike {@link Formation.is_activating}, which is #1957-computed on the checklist read but not yet mirrored into the indexed document). */
  gates_cleared: boolean;
  is_activating: boolean;
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

/** Response body for `GET /api/formations`. */
export interface FormationsQueueResponse {
  tiles: FormationQueueTiles;
  rows: FormationQueueRow[];
  data_source: 'fixture' | 'live';
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
  version: number;
}

/** Raw response shape from `GET /formations/{project_uid}?v=1` — the GH-2267 plan's gap 3 (no `formation_uid`/timestamps). */
export interface UpstreamFormationChecklist {
  project_uid: string;
  template_uid: string;
  template_version: number;
  lifecycle: string;
  sections: { key: string; title: string; position: number }[];
  items: UpstreamFormationItem[];
  is_activating: boolean;
}

/** Everything `mapUpstreamFormationItem` needs beyond the raw item itself — none of it is on the wire. */
export interface FormationItemMapContext {
  formationUid: string;
  projectUid: string;
  projectSlug: string;
}

/**
 * One checklist item assigned to the caller, across every project they can read (GH-1956). Answers
 * "which items are assigned to me", which no upstream endpoint offers yet — the item index the Me
 * lens needs (one access-filtered query with an assignee filter) does not exist upstream (#1957).
 * `data_source: 'live'` on {@link MyFormationWorkResponse} therefore always returns `items: []`
 * rather than fabricating rows; this shape is what the eventual index response maps onto 1:1.
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
  /** Drives the "Required for Active" marker on the Pending Actions row. */
  is_gating: boolean;
  due_date: string | null;
  action: FormationItemAction;
  action_href: string | null;
  /** `If-Match` token for the Claim / Block-with-note mutation. */
  version: number;
}

/**
 * One formation the caller has at least one assigned item on (GH-1956's "My formations" = projects
 * with at least one item assigned to me — the direct-grant definition in the issue body is not
 * satisfiable, see the ticket's third comment). Maps onto the already-live formation projection
 * ({@link FormationQueueRow}) filtered to documents whose `assignees` contains the caller — derived
 * server-side today, unlike {@link MyFormationItemRow}, so the client shape doesn't change on swap.
 */
export interface MyFormationSummary {
  formation_uid: string;
  project_uid: string;
  project_slug: string;
  project_name: string;
  sub_stage: FormationSubStage;
  announcement_date: string | null;
  /** The three "My formations" subtitle buckets — see `formatMyFormationSubtitle`. */
  assigned_to_do: number;
  assigned_with_team: number;
  assigned_done: number;
  items_done: number;
  items_total: number;
  gating_done: number;
  gating_total: number;
  blocking_item_title: string | null;
}

/** Response body for `GET /api/user/formation-work` (GH-1956, Me lens only). */
export interface MyFormationWorkResponse {
  formations: MyFormationSummary[];
  items: MyFormationItemRow[];
  data_source: 'fixture' | 'live';
}

/**
 * `MyFormationSummary` decorated with pre-derived display fields for `my-formations-card` — mirrors
 * `DecoratedPendingAction` in `components.interface.ts`. Templates may only read signals/computed
 * values, never call a method, so `subtitle`/`progressPercent`/`announcementLabel` must be computed
 * once per row up front rather than via template-called functions.
 */
export interface DecoratedMyFormation extends MyFormationSummary {
  subtitle: string;
  progressPercent: number;
  announcementLabel: string | null;
}
