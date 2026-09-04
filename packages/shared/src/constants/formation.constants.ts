// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FormationSubStage } from '../interfaces/formation.interface';

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
  activating: 'Activating',
} as const satisfies Record<FormationSubStage, string>;
