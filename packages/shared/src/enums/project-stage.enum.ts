// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Project lifecycle stage.
 * Values mirror the upstream Goa enum declared in `lfx-v2-project-service` at
 * `api/project/v1/design/types.go` (`ProjectStageAttribute`).
 */
export enum ProjectStage {
  FormationExploratory = 'Formation - Exploratory',
  FormationEngaged = 'Formation - Engaged',
  FormationOnHold = 'Formation - On Hold',
  FormationDisengaged = 'Formation - Disengaged',
  FormationConfidential = 'Formation - Confidential',
  Active = 'Active',
  Archived = 'Archived',
  Prospect = 'Prospect',
}
