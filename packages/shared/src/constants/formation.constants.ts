// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FormationDrawerData, FormationRowActionConfig } from '../interfaces/formation-checklist.interface';
import type { FormationQueueTiles, FormationsQueueResponse, FormationSubStage } from '../interfaces/formation.interface';

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

/** `FormationItemDrawerComponent`'s sentinel for "closed" or "not yet loaded" — see `FormationDrawerData`. */
export const FORMATION_EMPTY_DRAWER_DATA: FormationDrawerData = { item: null, history: [] };

/**
 * `FormationChecklistRowComponent`'s `provisionable`/`request` action-button config, keyed by
 * action kind — typed via `satisfies` so a bad `severity` literal fails the build instead of
 * silently rendering an unstyled button, the way an untyped `*ngTemplateOutlet` context would.
 */
export const FORMATION_GATED_ROW_ACTIONS = {
  provisionable: { testidPrefix: 'formation-checklist-row-provision', label: 'Set up', severity: 'primary', outlined: false },
  request: { testidPrefix: 'formation-checklist-row-request', label: 'Request', severity: 'secondary', outlined: true },
} as const satisfies Record<'provisionable' | 'request', FormationRowActionConfig>;

/** `FormationsQueueComponent`'s zeroed tile counts — the `catchError`/pre-fetch fallback for `FormationQueueTiles`. */
export const FORMATION_EMPTY_QUEUE_TILES: FormationQueueTiles = {
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
};

/** `FormationsQueueComponent`'s sentinel for "not yet loaded" or a failed fetch. */
export const FORMATION_EMPTY_QUEUE_RESPONSE: FormationsQueueResponse = { tiles: FORMATION_EMPTY_QUEUE_TILES, rows: [], data_source: 'fixture' };
