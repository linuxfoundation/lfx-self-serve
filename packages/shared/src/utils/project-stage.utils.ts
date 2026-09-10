// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectStage } from '../enums/project-stage.enum';

const FORMATION_STAGE_PREFIX = 'Formation - ';

/**
 * True for any `Formation - *` stage — the Formation checklist gate shared by
 * `formationProjectEnabledGuard`, `FormationService`, and the sidebar's Formation nav-link
 * visibility (GH-1958), so route access, backend enforcement, and nav visibility can't disagree.
 * A prefix match, not a fixed list of the five current `ProjectStage.Formation*` members, so a new
 * Formation sub-stage added upstream (`lfx-v2-project-service`) before this enum is updated still
 * gates on correctly. `stage` is `ProjectStage | string` on `Project` for the same reason (tolerates
 * values indexed before this attribute was rolled out), so this accepts a bare string too.
 *
 * Distinct from `isFormationStage` (`project.utils.ts`) — that one is the GH-1955 badge/card
 * feature's label-lookup check (also treats the `Draft` sentinel as in-Formation); this one never
 * matches `Draft` and tolerates unrecognized Formation sub-stages by design. Keep the two separate
 * rather than merging them — they gate different surfaces with deliberately different edge-case
 * behavior.
 */
export function isFormationStageGate(stage: ProjectStage | string | undefined | null): boolean {
  return typeof stage === 'string' && stage.startsWith(FORMATION_STAGE_PREFIX);
}
