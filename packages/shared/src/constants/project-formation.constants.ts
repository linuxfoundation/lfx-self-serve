// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectStage } from '../enums/project-stage.enum';

/**
 * Short display labels for the Formation sub-stages, used to build strings like
 * `FORMATION · Engaged` and the sidebar Formation card's sub-stage pill. Each label is the
 * `ProjectStage` enum value with its `Formation - ` prefix dropped.
 *
 * Keyed by `ProjectStage` (5 values, including `Disengaged` and `Confidential`) — a different map
 * from the canonical `FORMATION_SUB_STAGE_LABELS` in `formation.constants.ts` (GH-2163), which is
 * keyed by the `FormationSubStage` union. Named distinctly so the two don't collide as re-exports
 * of the same barrel.
 */
export const PROJECT_FORMATION_STAGE_LABELS: Partial<Record<ProjectStage, string>> = {
  [ProjectStage.FormationExploratory]: 'Exploratory',
  [ProjectStage.FormationEngaged]: 'Engaged',
  [ProjectStage.FormationOnHold]: 'On Hold',
  [ProjectStage.FormationDisengaged]: 'Disengaged',
  [ProjectStage.FormationConfidential]: 'Confidential',
};

/**
 * Sentinel value referenced by ticket GH-1955 ("Draft status or any Formation sub-stage") with
 * no backing `ProjectStage` member today. Kept as a defensive literal check in
 * `getFormationSubStageLabel` (which `isFormationStage` delegates to) so a future upstream
 * addition of this value doesn't silently fall outside the gate — not evidence that upstream
 * currently emits it.
 */
export const DRAFT_STAGE_SENTINEL = 'Draft';
