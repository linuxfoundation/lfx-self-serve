// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { TagSeverity } from '../interfaces/components.interface';
import type { FormationDrawerData, FormationLinkRowActionConfig, FormationRowActionConfig } from '../interfaces/formation-checklist.interface';
import type {
  FormationEntityType,
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

/** `FormationsTableComponent`'s Type column display label — `entity_type` is stored as-is (never renamed for UI), so the raw value never reaches the template directly. */
export const FORMATION_ENTITY_TYPE_LABELS = {
  foundation: 'Foundation',
  child_project: 'Child project',
  project: 'Project',
} as const satisfies Record<FormationEntityType, string>;

/**
 * The single Epic-1 seeded template's fixture UID (#1959 owns the real seed content). Shared
 * between the BFF fixture generator (`formation-fixture.helper.ts`) and e2e fixtures so they can't
 * drift out of sync.
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
  return { item: null, history: [] };
}

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
  child_projects: 0,
} as const satisfies FormationQueueTiles;

/**
 * `FormationsQueueComponent`'s sentinel for "not yet loaded" or a failed fetch — a factory, not a
 * shared object, so its `toSignal` `initialValue` use and its `catchError` fallback use each get
 * their own `tiles`/`rows`, never one singleton two call sites could mutate through each other.
 */
export function createEmptyFormationsQueueResponse(): FormationsQueueResponse {
  return { tiles: { ...FORMATION_EMPTY_QUEUE_TILES }, rows: [], data_source: 'fixture' };
}

/** `FormationChecklistRowComponent`'s status chip labels, mirroring `POLL_STATUS_LABELS`'s pattern. */
export const FORMATION_ITEM_STATUS_LABELS = {
  done: 'Done',
  in_progress: 'In progress',
  blocked: 'Blocked',
  awaiting_acceptance: 'With formation team',
  not_started: 'Not started',
  skipped: 'Skipped',
} as const satisfies Record<FormationItemStatus, string>;

/** `FormationChecklistRowComponent`'s status chip severities, mirroring `POLL_STATUS_SEVERITY`'s pattern. */
export const FORMATION_ITEM_STATUS_SEVERITY = {
  done: 'success',
  in_progress: 'warn',
  blocked: 'danger',
  awaiting_acceptance: 'info',
  not_started: 'secondary',
  skipped: 'secondary',
} as const satisfies Record<FormationItemStatus, TagSeverity>;

/** `FormationReadinessStripComponent`'s per-segment fill color, keyed by item status. Not `done` must never read green. */
export const FORMATION_ITEM_SEGMENT_COLORS = {
  done: 'bg-emerald-600',
  in_progress: 'bg-amber-500',
  blocked: 'bg-red-500',
  awaiting_acceptance: 'bg-blue-500',
  not_started: 'bg-gray-200',
  skipped: 'bg-gray-400',
} as const satisfies Record<FormationItemStatus, string>;
