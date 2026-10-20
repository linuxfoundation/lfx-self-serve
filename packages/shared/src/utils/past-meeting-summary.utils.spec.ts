// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { PastMeetingSummary } from '../interfaces';
import {
  getPastMeetingSummaryApprovalState,
  getPastMeetingSummaryContent,
  isPastMeetingSummaryReadOnly,
  isPastMeetingSummaryVisible,
} from './past-meeting-summary.utils';

const withContent = (content: string, edited_content: string): Pick<PastMeetingSummary, 'summary_data'> => ({
  summary_data: { title: 'Summary', content, edited_content, doc_url: '', start_time: '', end_time: '' },
});

describe('getPastMeetingSummaryApprovalState', () => {
  // One model for page, modal and card (E4-03): a summary that never required approval is not "pending".
  it.each([
    [{ approved: true, requires_approval: true }, 'approved'],
    [{ approved: true, requires_approval: false }, 'approved'],
    [{ approved: false, requires_approval: true }, 'pending'],
    [{ approved: false, requires_approval: false }, 'not-required'],
  ] as const)('reads %o as %s, agreeing with isPastMeetingSummaryVisible', (flags, state) => {
    expect(getPastMeetingSummaryApprovalState(flags)).toBe(state);
    expect(isPastMeetingSummaryVisible(flags)).toBe(state !== 'pending');
  });
});

describe('getPastMeetingSummaryContent', () => {
  it("prefers the organizer's edit, else the generated content", () => {
    expect(getPastMeetingSummaryContent(withContent('Generated', 'Edited'))).toBe('Edited');
    expect(getPastMeetingSummaryContent(withContent('Generated', ''))).toBe('Generated');
  });

  it('falls back to the generated content when the edit is only whitespace', () => {
    expect(getPastMeetingSummaryContent(withContent('Generated', '  \n'))).toBe('Generated');
  });

  it('is empty for a record with no content, so it surfaces no affordance', () => {
    expect(getPastMeetingSummaryContent(withContent('  ', ''))).toBe('');
    expect(getPastMeetingSummaryContent(null)).toBe('');
  });
});

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
