// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  FORMATION_ACTIVITY_ACTION_LABELS,
  FORMATION_CHECKLIST_HEADING,
  FORMATION_ITEMS_HEADING,
  FORMATION_NO_CHECKLIST_COPY,
  FORMATION_NO_CHECKLIST_DISENGAGED_COPY,
  FORMATION_POST_FORMATION_SUBTITLES,
  getFormationNoChecklistCopy,
} from './formation.constants';
import { ProjectStage } from '../enums/project-stage.enum';
import { FORMATION_INVITE_ROLE_OPTIONS } from './formation-people.constants';
import { FORMATION_RECORD_SUCCESS_MESSAGE } from './project-formation.constants';

/**
 * #5635: copy shared by `/project/formation` and `/foundation/formations/:slug` stays neutral
 * ("formation items") so it reads fine on both hosts. Only the /project/formation heading keeps "Checklist".
 */
describe('formation shared copy (#5635)', () => {
  it('keeps "Formation Checklist" as the default heading and "Formation items" for the foundation drill-down', () => {
    expect(FORMATION_CHECKLIST_HEADING).toBe('Formation Checklist');
    expect(FORMATION_ITEMS_HEADING).toBe('Formation items');
  });

  it('words the manage access level and the template-upgrade activity line', () => {
    expect(FORMATION_INVITE_ROLE_OPTIONS.find((option) => option.value === 'manage')?.description).toBe('Can also assign and edit formation items.');
    expect(FORMATION_ACTIVITY_ACTION_LABELS.template_upgraded).toBe('upgraded the formation template');
  });

  it.each([
    ['record success toast', [FORMATION_RECORD_SUCCESS_MESSAGE]],
    ['invite access-level descriptions', FORMATION_INVITE_ROLE_OPTIONS.map((option) => option.description)],
    ['template activity lines', [FORMATION_ACTIVITY_ACTION_LABELS.template_expanded, FORMATION_ACTIVITY_ACTION_LABELS.template_upgraded]],
    ['no-items empty state', Object.values(FORMATION_NO_CHECKLIST_COPY)],
    ['disengaged empty state', Object.values(FORMATION_NO_CHECKLIST_DISENGAGED_COPY)],
    ['post-formation subtitles', Object.values(FORMATION_POST_FORMATION_SUBTITLES)],
  ])('has no "checklist" wording in the %s', (_name, strings) => {
    for (const text of strings) {
      expect(text).not.toMatch(/checklist/i);
    }
  });

  it('words the post-formation subtitle by stage: Active completed formation, Archived may never have launched', () => {
    expect(FORMATION_POST_FORMATION_SUBTITLES[ProjectStage.Active]).toBe('It has completed formation.');
    expect(FORMATION_POST_FORMATION_SUBTITLES[ProjectStage.Archived]).toBe('It has been archived.');
  });

  it('explains a disengaged project with nothing to track, and keeps the existing copy for Draft and any other stage', () => {
    expect(getFormationNoChecklistCopy(ProjectStage.FormationDisengaged).subtitle).toBe('This project is disengaged.');
    expect(getFormationNoChecklistCopy(ProjectStage.Prospect)).toBe(FORMATION_NO_CHECKLIST_COPY);
    expect(getFormationNoChecklistCopy(ProjectStage.FormationExploratory)).toBe(FORMATION_NO_CHECKLIST_COPY);
    expect(getFormationNoChecklistCopy(null)).toBe(FORMATION_NO_CHECKLIST_COPY);
    expect(FORMATION_NO_CHECKLIST_COPY.subtitle).toBe('Formation items start when the project moves into a formation stage.');
  });
});
