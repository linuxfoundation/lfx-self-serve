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
  uid: string;
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
  created_at: string;
  updated_at: string;
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
export type FormationItemAction = 'manual' | 'link' | 'provisionable' | 'request' | 'status_only';

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
 * Per-`sub_stage` counts for the queue's filter pills. `foundations` and `child_projects` name
 * the {@link FormationEntityType} derived taxonomy — `child_projects` counts both `child_project`
 * and `project` rows (i.e. every non-foundation), so a plain top-level project isn't dropped from
 * the breakdown while still counting toward `total`.
 */
export type FormationQueueTiles = Record<FormationSubStage, number> & {
  total: number;
  foundations: number;
  child_projects: number;
};

/** Response body for `GET /api/formations`. */
export interface FormationsQueueResponse {
  tiles: FormationQueueTiles;
  rows: Formation[];
  data_source: 'fixture' | 'live';
}
