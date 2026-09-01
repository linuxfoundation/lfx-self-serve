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
