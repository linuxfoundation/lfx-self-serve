// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectStage } from '../enums/project-stage.enum';

const FORMATION_STAGES: ReadonlySet<string> = new Set([
  ProjectStage.FormationExploratory,
  ProjectStage.FormationEngaged,
  ProjectStage.FormationOnHold,
  ProjectStage.FormationDisengaged,
  ProjectStage.FormationConfidential,
]);

/** True for any `Formation - *` stage (GH-1958 checklist-section gate). `stage` is `ProjectStage | string` on `Project` to tolerate values indexed before an attribute was rolled out, so this accepts a bare string too. */
export function isFormationStage(stage: ProjectStage | string | undefined | null): boolean {
  return !!stage && FORMATION_STAGES.has(stage);
}
