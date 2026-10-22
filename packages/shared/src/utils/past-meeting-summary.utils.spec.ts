// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isPastMeetingSummaryReadOnly } from './past-meeting-summary.utils';

describe('isPastMeetingSummaryReadOnly', () => {
  // Every combination of the organizer flag (true / false / absent) with the summary's uid
  // (present / empty / no summary at all). Only an organizer with a uid to write back to may edit.
  it.each([
    { organizer: true, summary: { uid: 'sum-1' }, expected: false },
    { organizer: true, summary: { uid: '' }, expected: true },
    { organizer: true, summary: null, expected: true },
    { organizer: false, summary: { uid: 'sum-1' }, expected: true },
    { organizer: false, summary: { uid: '' }, expected: true },
    { organizer: false, summary: null, expected: true },
    { organizer: undefined, summary: { uid: 'sum-1' }, expected: true },
    { organizer: undefined, summary: { uid: '' }, expected: true },
    { organizer: undefined, summary: null, expected: true },
  ])('returns $expected for organizer=$organizer and summary=$summary', ({ organizer, summary, expected }) => {
    expect(isPastMeetingSummaryReadOnly({ organizer }, summary)).toBe(expected);
  });

  it('fails closed when the meeting has not loaded', () => {
    expect(isPastMeetingSummaryReadOnly(null, { uid: 'sum-1' })).toBe(true);
    expect(isPastMeetingSummaryReadOnly(undefined, { uid: 'sum-1' })).toBe(true);
  });

  it('fails closed when the summary is undefined rather than null', () => {
    expect(isPastMeetingSummaryReadOnly({ organizer: true }, undefined)).toBe(true);
  });
});
