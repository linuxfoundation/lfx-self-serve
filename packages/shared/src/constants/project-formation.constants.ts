// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectStage } from '../enums/project-stage.enum';

/**
 * Short display labels for the Formation sub-stages — the project dashboard's "Stage Formation ·
 * Engaged" subtitle and the sidebar Formation card's sub-stage pill. Each label is the
 * `ProjectStage` enum value with its `Formation - ` prefix dropped.
 *
 * Keyed by `ProjectStage` (5 values, including `Disengaged` and `Confidential`) — a different map
 * from the canonical `FORMATION_SUB_STAGE_LABELS` in `formation.constants.ts` (GH-2163), which is
 * keyed by the 3-value `FormationSubStage` union the two formation list pages render. Named
 * distinctly so the two don't collide as re-exports of the same barrel.
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

/**
 * Stages the formation team may set from the formation card (#5134): the four Formation
 * sub-stages, Active and Archived. `Prospect` is deliberately absent, and `Formation - Confidential`
 * is not a supported v2 stage — the BFF rejects anything outside this list.
 */
export const FORMATION_RECORD_SELECTABLE_STAGES: readonly ProjectStage[] = [
  ProjectStage.FormationExploratory,
  ProjectStage.FormationEngaged,
  ProjectStage.FormationOnHold,
  ProjectStage.FormationDisengaged,
  ProjectStage.Active,
  ProjectStage.Archived,
];

/** Stages whose selection needs a confirmation step stating the checklist effect (D5). */
export const FORMATION_RECORD_CONFIRM_STAGES: readonly ProjectStage[] = [ProjectStage.Active, ProjectStage.Archived, ProjectStage.FormationDisengaged];

/** Upstream `legal_entity_type` enum (lfx-v2-project-service `ProjectLegalEntityTypeAttribute`). */
export const PROJECT_LEGAL_ENTITY_TYPES: readonly string[] = [
  'Subproject',
  'Incorporated Entity',
  'Series LLC',
  'Unofficial Subproject',
  'Internal Allocation',
  'None',
];

/** Error codes returned by `PUT /api/projects/:uid/formation-record`. */
export const NOT_PROJECT_WRITER_CODE = 'NOT_PROJECT_WRITER';
export const FORMATION_TEAM_REQUIRED_CODE = 'FORMATION_TEAM_REQUIRED';
export const FORMATION_RECORD_CONFLICT_CODE = 'FORMATION_RECORD_CONFLICT';

/** User-facing copy per outcome, exactly as the #5134 error table. */
export const FORMATION_RECORD_ERROR_MESSAGES = {
  notWriter: "You don't have permission to edit this project.",
  notFormationTeam: 'Only the formation team can change stage and legal entity.',
  archivedNeedsDissolutionDate: 'Archiving needs a dissolution date.',
  invalidValue: "That value can't be saved. Check the fields and try again.",
  conflict: 'Someone else changed this project. Reload to see the latest, then try again.',
  notFound: "This project couldn't be found.",
  generic: "Couldn't save. Try again.",
} as const;
