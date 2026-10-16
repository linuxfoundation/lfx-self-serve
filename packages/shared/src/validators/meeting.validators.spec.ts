// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AbstractControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { MEETING_AGENDA_MAX_LENGTH, MEETING_AGENDA_WARNING_LENGTH } from '../constants/meeting.constants';
import { meetingAgendaValidator } from './meeting.validators';

// One agenda limit for the validator and every agenda input (#3612).
describe('meetingAgendaValidator', () => {
  // The validator only reads control.value, so a bare object stands in for an AbstractControl.
  const validate = (value: string) => meetingAgendaValidator()({ value } as AbstractControl);

  it('accepts an agenda at the shared limit', () => {
    expect(validate('x'.repeat(MEETING_AGENDA_MAX_LENGTH))).toBeNull();
  });

  it('rejects one character past it, naming the shared limit', () => {
    expect(validate('x'.repeat(MEETING_AGENDA_MAX_LENGTH + 1))).toEqual({
      maxLength: { requiredLength: MEETING_AGENDA_MAX_LENGTH, actualLength: MEETING_AGENDA_MAX_LENGTH + 1 },
    });
  });

  it('derives the warning threshold from the limit', () => {
    expect(MEETING_AGENDA_WARNING_LENGTH).toBe(Math.round(MEETING_AGENDA_MAX_LENGTH * 0.9));
    expect(MEETING_AGENDA_WARNING_LENGTH).toBeLessThan(MEETING_AGENDA_MAX_LENGTH);
  });
});
