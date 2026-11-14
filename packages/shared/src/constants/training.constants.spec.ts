// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELD,
  DEFAULT_ORG_TRAINING_TAB_ID,
  DESCENDING_DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELDS,
  ORG_ALL_EMPLOYEES_TRAINING_WINDOW_NOTE,
  ORG_TRAINING_ENROLLMENT_WINDOW_MONTHS,
  ORG_TRAINING_TABS,
  PERSON_DETAIL_TRAINING_WINDOW_NOTE,
  VALID_ORG_TRAINING_GROUPS_SORT_FIELDS,
  VALID_ORG_TRAINING_TAB_IDS,
} from './training.constants';

describe('training enrollment window', () => {
  it.each([PERSON_DETAIL_TRAINING_WINDOW_NOTE, ORG_ALL_EMPLOYEES_TRAINING_WINDOW_NOTE])('states the window in "%s"', (note) => {
    expect(note).toContain(`last ${ORG_TRAINING_ENROLLMENT_WINDOW_MONTHS} months`);
    expect(note).not.toMatch(/all time/i);
  });
});

describe('org training page constants', () => {
  it('splits the group table into a Certifications and a Trainings tab, Certifications first', () => {
    expect(ORG_TRAINING_TABS.map((tab) => tab.id)).toEqual(['certifications', 'trainings']);
    expect(DEFAULT_ORG_TRAINING_TAB_ID).toBe('certifications');
    expect([...VALID_ORG_TRAINING_TAB_IDS]).toEqual(['certifications', 'trainings']);
  });

  it('sorts the group table by completed, descending, by default, and every descending-first field is sortable', () => {
    expect(DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELD).toBe('completed');
    expect(VALID_ORG_TRAINING_GROUPS_SORT_FIELDS.has(DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELD)).toBe(true);
    expect(DESCENDING_DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELDS.has('label')).toBe(false);
    for (const field of DESCENDING_DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELDS) {
      expect(VALID_ORG_TRAINING_GROUPS_SORT_FIELDS.has(field)).toBe(true);
    }
  });
});
