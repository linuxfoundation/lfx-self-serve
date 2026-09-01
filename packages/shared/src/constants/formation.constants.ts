// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { TagSeverity } from '../interfaces/components.interface';
import type { FormationDrawerData, FormationLinkRowActionConfig, FormationRowActionConfig } from '../interfaces/formation-checklist.interface';
import type { FormationItemStatus, FormationQueueTiles, FormationsQueueResponse, FormationSubStage } from '../interfaces/formation.interface';

/** Queue filter-pill order (`All` is derived, not listed) — includes `withdrawn` per GH-1958. */
export const FORMATION_QUEUE_SUB_STAGES: FormationSubStage[] = ['proposed', 'exploratory', 'engaged', 'on_hold', 'activating', 'withdrawn'];

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
  proposed: 0,
  exploratory: 0,
  engaged: 0,
  on_hold: 0,
  activating: 0,
  withdrawn: 0,
  total: 0,
  foundations: 0,
  subprojects: 0,
  mine: 0,
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
  waiting_on_partner: 'Waiting on partner',
  not_started: 'Not started',
  skipped: 'Skipped',
} as const satisfies Record<FormationItemStatus, string>;

/** `FormationChecklistRowComponent`'s status chip severities, mirroring `POLL_STATUS_SEVERITY`'s pattern. */
export const FORMATION_ITEM_STATUS_SEVERITY = {
  done: 'success',
  in_progress: 'warn',
  waiting_on_partner: 'accent',
  not_started: 'secondary',
  skipped: 'secondary',
} as const satisfies Record<FormationItemStatus, TagSeverity>;
