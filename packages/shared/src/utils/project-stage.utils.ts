// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectStage } from '../enums/project-stage.enum';

const FORMATION_STAGE_PREFIX = 'Formation - ';

/**
 * True for any `Formation - *` stage (GH-1958 checklist-section gate) — a prefix match, not a
 * fixed list of the five current `ProjectStage.Formation*` members, so a new Formation sub-stage
 * added upstream (`lfx-v2-project-service`) before this enum is updated still gates the section on
 * correctly. `stage` is `ProjectStage | string` on `Project` for the same reason (tolerates values
 * indexed before this attribute was rolled out), so this accepts a bare string too.
 */
export function isFormationStage(stage: ProjectStage | string | undefined | null): boolean {
  return typeof stage === 'string' && stage.startsWith(FORMATION_STAGE_PREFIX);
}
