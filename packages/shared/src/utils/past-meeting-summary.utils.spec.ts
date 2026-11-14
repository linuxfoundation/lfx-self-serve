// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { PastMeetingSummary } from '../interfaces';
import { getPastMeetingSummaryContent, isPastMeetingSummaryReadOnly } from './past-meeting-summary.utils';

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

describe('getPastMeetingSummaryContent', () => {
  const summary = (flags: Partial<PastMeetingSummary>, content = 'Generated', edited = ''): PastMeetingSummary => ({
    uid: '',
    meeting_id: '',
    past_meeting_id: '',
    platform: '',
    approved: true,
    requires_approval: true,
    email_sent: false,
    password: '',
    summary_data: { title: '', content, edited_content: edited, doc_url: '', start_time: '', end_time: '' },
    created_at: '',
    updated_at: '',
    ...flags,
  });

  it('prefers the edited text', () => {
    expect(getPastMeetingSummaryContent({}, summary({}, 'Generated', 'Edited'))).toBe('Edited');
    expect(getPastMeetingSummaryContent({}, summary({}))).toBe('Generated');
  });

  it.each([
    { label: 'approved, invitee', flags: { approved: true }, organizer: undefined, expected: 'Generated' },
    { label: 'approval not required, invitee', flags: { approved: false, requires_approval: false }, organizer: false, expected: 'Generated' },
    { label: 'awaiting approval, invitee', flags: { approved: false }, organizer: false, expected: null },
    { label: 'awaiting approval, organizer', flags: { approved: false }, organizer: true, expected: 'Generated' },
  ])('$label', ({ flags, organizer, expected }) => {
    expect(getPastMeetingSummaryContent({ organizer }, summary(flags))).toBe(expected);
  });

  it('returns null for a blank or missing summary', () => {
    expect(getPastMeetingSummaryContent({ organizer: true }, summary({}, '  '))).toBeNull();
    expect(getPastMeetingSummaryContent({ organizer: true }, null)).toBeNull();
  });
});
