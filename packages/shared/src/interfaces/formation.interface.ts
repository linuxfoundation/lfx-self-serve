// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Formation domain types (GH-1958, epic #1965). Mirrors the object shapes planned for
 * `lfx-v2-formation-service` (#1957) — `formation`, `formation_item`, `activity` — scoped to Epic
 * 1: no `request` object/SLA tracking (that richer model is #1957/Epic 2), no invites, no
 * Confidential read-guard switch.
 *
 * TODO(#1957): every interface here is shaped to match the real service's eventual response
 * bodies as closely as fixtures allow, so wiring the real service is a data-source swap in
 * `formation.service.ts`, not a type change. See `formation-backend.helper.ts` for the swap point.
 */

/** Formation lifecycle state — coarse, distinct from {@link FormationSubStage}'s queue taxonomy. */
export type FormationState = 'draft' | 'submitted' | 'active' | 'withdrawn';

/**
 * Formations queue display taxonomy (queue filters, sub-stage pill). Distinct from
 * {@link FormationState}: `sub_stage` is what the queue filters/pills key off, including
 * `withdrawn` (GH-1958's "Filters (incl. Withdrawn)" requirement).
 */
export type FormationSubStage = 'proposed' | 'exploratory' | 'engaged' | 'on_hold' | 'activating' | 'withdrawn';

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

export interface FormationLead {
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
  state: FormationState;
  sub_stage: FormationSubStage;
  /** ISO date. Null until a gating item sets it. */
  announcement_date: string | null;
  /** Derived: every gating item `done` (and at least one gating item exists). TODO(#1957): backend-derived once real; see `deriveFormationReadinessSummary`, which computes this identically. */
  is_activating: boolean;
  gating_items_open: number;
  gating_items_total: number;
  /** First not-done gating item's title, precomputed for the queue's "Blocking" column. */
  blocking_item_title: string | null;
  lead: FormationLead | null;
  proposer: FormationLead | null;
  subtitle: string | null;
  created_at: string;
  updated_at: string;
}

/** 5-state taxonomy confirmed against the design mockup — includes `waiting_on_partner`, distinct from `in_progress`. */
export type FormationItemStatus = 'not_started' | 'in_progress' | 'waiting_on_partner' | 'done' | 'skipped';

/**
 * One row's action affordance. `request` is a real, working Epic-1 action (fixture-only: files a
 * lightweight request and flips the item to `waiting_on_partner`, no SLA/target-team object — that
 * richer `request` type is #1957/Epic 2). `status_only` items never expose how the underlying
 * tooling was set up (manual vs automated) — only Done/pending + an optional link.
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
  /** Only gating items count toward `is_activating` and show the "Gates Active" chip. */
  is_gating: boolean;
  owner_team: string | null;
  owner: FormationLead | null;
  due_date: string | null;
  action: FormationItemAction;
  /** For `link`/`status_only` rows that open something external. */
  action_href: string | null;
  detail: string | null;
  notes: string | null;
  links: FormationItemLink[];
  sub_items: FormationSubItem[];
  /** Required and logged when a gating item is skipped. */
  skip_reason: string | null;
  /**
   * Per-item `gate_writer` permission — response-only, enrichment output. TODO(#1957): fabricated
   * today by `FormationItemAccessService.canComplete` from a real LF-staff check; swap for a real
   * `checkSingleAccess(req, { resource: 'formation_item', id, access: 'gate_writer' })` call once
   * the relation ships.
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
  | 'due_date_changed'
  | 'formation_submitted'
  | 'formation_accepted'
  | 'formation_declined';

export interface FormationActivity {
  uid: string;
  formation_uid: string;
  /** Null for formation-level activity (e.g. submitted/accepted/declined). */
  formation_item_uid: string | null;
  type: FormationActivityType;
  actor: FormationLead;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Structure only for Epic 1 — no template editor (#1994/Epic 2). One seeded template (#1959)
 * applied automatically when a formation is created.
 */
export interface FormationTemplate {
  uid: string;
  version: number;
  name: string;
  sections: FormationTemplateSection[];
}

export interface FormationTemplateSection {
  key: string;
  title: string;
  items: FormationTemplateItem[];
}

export interface FormationTemplateItem {
  key: string;
  title: string;
  is_gating: boolean;
  owner_team: string | null;
  /** `'status_only'` IS the status-only signal — there is no separate boolean to keep in sync with it. */
  action: FormationItemAction;
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

/** Response body for `GET /api/formations`. */
export interface FormationsQueueResponse {
  tiles: FormationQueueTiles;
  rows: Formation[];
  data_source: 'fixture' | 'live';
}
