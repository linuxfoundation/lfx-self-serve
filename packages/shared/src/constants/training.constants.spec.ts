// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  ORG_CERT_IN_PROGRESS_WINDOW_NOTE,
  ORG_CERTIFICATIONS_WINDOW_NOTE,
  ORG_TRAINING_ENROLLMENT_WINDOW_MONTHS,
  PERSON_DETAIL_TRAINING_WINDOW_NOTE,
} from './training.constants';

describe('training enrollment window', () => {
  it.each([ORG_CERTIFICATIONS_WINDOW_NOTE, ORG_CERT_IN_PROGRESS_WINDOW_NOTE, PERSON_DETAIL_TRAINING_WINDOW_NOTE])('states the window in "%s"', (note) => {
    expect(note).toContain(`last ${ORG_TRAINING_ENROLLMENT_WINDOW_MONTHS} months`);
    expect(note).not.toMatch(/all time/i);
  });
});
