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

/** What kind of record is in formation — drives the queue's Type column and indentation. */
export type FormationEntityType = 'foundation' | 'subproject' | 'project';

export interface FormationLead {
  username: string;
  name: string;
}

export interface Formation {
  uid: string;
  parent_project_uid: string;
  parent_project_slug: string;
  parent_project_name: string;
  /** Present only for a `subproject` — the foundation/project this formation nests under, for the queue's indented display. */
  parent_formation_name?: string;
  entity_type: FormationEntityType;
  template_uid: string;
  template_version: number;
  state: FormationState;
  sub_stage: FormationSubStage;
  /** ISO date. Null until a gating item sets it. */
  announcement_date: string | null;
  /** Derived: every gating item `done` AND `announcement_date` set. TODO(#1957): backend-derived once real; see `deriveFormationReadinessSummary`. */
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
  action: FormationItemAction;
  status_only: boolean;
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
  subprojects: number;
  mine: number;
};

/** Response body for `GET /api/formations`. */
export interface FormationsQueueResponse {
  tiles: FormationQueueTiles;
  rows: Formation[];
  data_source: 'fixture' | 'live';
}
