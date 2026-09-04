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
 * What kind of record is in formation — drives the queue's Type column and indentation.
 * TODO(#1958): this is a display taxonomy that should be derived (`is_foundation` on the project,
 * plus "parent is not the root" for a child project) rather than stored; `child_project` is kept
 * as a stored value for now because the canonical `Formation` has neither signal yet.
 */
export type FormationEntityType = 'foundation' | 'child_project' | 'project';

/** A plain user reference — not an Epic 2 "formation lead" record (#1992), which doesn't exist in Epic 1. */
export interface FormationUser {
  username: string;
  name: string;
}

export interface Formation {
  uid: string;
  parent_project_uid: string;
  parent_project_slug: string;
  parent_project_name: string;
  /** Present only for a `child_project` — the foundation/project this formation nests under, for the queue's indented display. */
  parent_formation_name?: string;
  entity_type: FormationEntityType;
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
  /** For `link`/`status_only` rows that open something external. */
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
  sub_items?: FormationTemplateSubItem[];
}

/** Response body for `GET /api/projects/:slug/formation`. */
export interface FormationChecklistResponse {
  formation: Formation;
  template: FormationTemplate | null;
  items: FormationItem[];
  data_source: 'fixture' | 'live';
}

/** Per-`sub_stage` counts for the queue's filter pills. */
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
