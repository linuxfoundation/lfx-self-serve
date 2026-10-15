// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { PastMeetingSummary } from '../interfaces';
import {
  getPastMeetingSummaryApprovalState,
  getPastMeetingSummaryContent,
  isPastMeetingSummaryVisible,
  toPublicPastMeetingSummary,
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

describe('toPublicPastMeetingSummary', () => {
  it('keeps the text and approval flags but drops the Zoom document link, its password and config', () => {
    const summary = {
      uid: 'sum-1',
      meeting_id: 'm-1',
      past_meeting_id: 'pm-1',
      platform: 'Zoom',
      approved: true,
      requires_approval: true,
      email_sent: true,
      password: 'zoom-secret',
      summary_data: {
        title: 'Summary',
        content: 'Generated',
        edited_content: 'Edited',
        doc_url: 'https://docs.zoom.example/s/1',
        start_time: '',
        end_time: '',
      },
      zoom_config: { meeting_id: 'z-1', meeting_uuid: 'u-1' },
      created_at: '',
      updated_at: '',
      // A field upstream may add later, which an allowlist must not forward.
      created_by: { email: 'creator@example.com' },
    } as PastMeetingSummary;

    const result = toPublicPastMeetingSummary(summary);

    // Only the text in effect: the organizer's edit, never the generated text it replaced.
    expect(result.summary_data).toEqual({ ...summary.summary_data, content: 'Edited', edited_content: '', doc_url: '' });
    expect(JSON.stringify(result)).not.toContain('Generated');
    expect(result.approved).toBe(true);
    expect(result.password).toBe('');
    expect(result.email_sent).toBe(false);
    expect('zoom_config' in result).toBe(false);
    expect(JSON.stringify(result)).not.toContain('zoom-secret');
    expect(JSON.stringify(result)).not.toContain('creator@example.com');
    expect(summary.password).toBe('zoom-secret');
  });
});
