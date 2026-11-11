// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { FORMATION_ACTIVITY_ACTION_LABELS, FORMATION_CHECKLIST_HEADING, FORMATION_ITEMS_HEADING, FORMATION_NO_CHECKLIST_COPY } from './formation.constants';
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

  it.each([
    ['record success toast', [FORMATION_RECORD_SUCCESS_MESSAGE]],
    ['invite access-level descriptions', FORMATION_INVITE_ROLE_OPTIONS.map((option) => option.description)],
    ['template activity lines', [FORMATION_ACTIVITY_ACTION_LABELS.template_expanded, FORMATION_ACTIVITY_ACTION_LABELS.template_upgraded]],
    ['no-items empty state', Object.values(FORMATION_NO_CHECKLIST_COPY)],
  ])('has no "checklist" wording in the %s', (_name, strings) => {
    for (const text of strings) {
      expect(text).not.toMatch(/checklist/i);
    }
  });
});
