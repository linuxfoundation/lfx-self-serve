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

/**
 * The PCC test projects (lfx-pcc helper.ts). They behave as foundations by name (`computeIsFoundation`) and are left out
 * of the formation Pipeline with everything under them (#5619). Exact names, as stored.
 */
export const TEST_PROJECT_NAMES: readonly string[] = ['Test Project Group IT', 'Test Project IT'];

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

/** The only keys `PUT /api/projects/:uid/formation-record` may change; anything else in the body is rejected. */
export const FORMATION_RECORD_EDITABLE_KEYS = [
  'stage',
  'legal_entity_name',
  'legal_entity_type',
  'formation_date',
  'entity_dissolution_date',
  'entity_formation_document_url',
] as const;

/** Read-only fields on the upstream project GET that must not be sent back on the full-replace PUT. */
export const FORMATION_RECORD_READ_ONLY_KEYS = ['uid', 'created_at', 'updated_at', 'writer', 'auditor', 'meetingCoordinator'] as const;

/** `YYYY-MM-DD` shape for the formation and dissolution dates — shared by the drawer's pre-check and the BFF's validation. */
export const FORMATION_RECORD_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Upper bounds for the free-text formation-record fields, so oversized values never reach upstream. */
export const FORMATION_RECORD_MAX_LENGTHS = { legal_entity_name: 255, entity_formation_document_url: 2048 } as const;

/** Error codes returned by `PUT /api/projects/:uid/formation-record`. */
export const NOT_PROJECT_WRITER_CODE = 'NOT_PROJECT_WRITER';
export const FORMATION_TEAM_REQUIRED_CODE = 'FORMATION_TEAM_REQUIRED';
export const FORMATION_RECORD_CONFLICT_CODE = 'FORMATION_RECORD_CONFLICT';
/** `errors[].code` on the 400 for the Archived rule only — a malformed date keeps the generic field-validation code. */
export const FORMATION_RECORD_DISSOLUTION_DATE_REQUIRED_CODE = 'DISSOLUTION_DATE_REQUIRED';

/** Success toast copy, including the propagation note from #5134: the checklist is updated asynchronously by formation-service. */
export const FORMATION_RECORD_SUCCESS_MESSAGE = 'Updated. The checklist may take a minute to reflect the new stage.';

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
