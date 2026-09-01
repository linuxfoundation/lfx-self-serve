// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FormationSubStage } from '../interfaces/formation.interface';

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
