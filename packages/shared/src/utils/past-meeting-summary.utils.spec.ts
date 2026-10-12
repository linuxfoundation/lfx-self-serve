// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { PastMeetingSummary } from '../interfaces';
import { getPastMeetingSummaryApprovalState, getPastMeetingSummaryContent, isPastMeetingSummaryVisible } from './past-meeting-summary.utils';

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
