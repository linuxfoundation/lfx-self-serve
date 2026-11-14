// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { LINKEDIN_RECORDED_PROGRESS } from '../constants/linkedin-post-questions.fixture';
import { linkedinRunActivity, publicLinkedinPayloads } from './linkedin-post-run.utils';

describe('LinkedIn safe public activity', () => {
  it('replays curated recorded public progress without retaining recorded reasoning or authentication metadata', () => {
    const payloads = LINKEDIN_RECORDED_PROGRESS.map((event) => JSON.stringify(event));
    expect(publicLinkedinPayloads(payloads)).toHaveLength(2);
    const activity = linkedinRunActivity(payloads);
    expect(activity).toHaveLength(2);
    expect(JSON.stringify(activity)).not.toContain('PRIVATE_REASONING_MARKER');
    expect(JSON.stringify(LINKEDIN_RECORDED_PROGRESS)).not.toContain('api_key');
  });

  it.each(['agent_notification_progress', 'agent_notification_message', 'llm_done'])(
    'filters streaming/final reasoning regardless of event type (%s)',
    (eventType) => {
      const payloads = [
        JSON.stringify({
          id: 'reasoning-stream',
          type: eventType,
          content: { type: 'application/guild-reasoning-progress', data: 'PRIVATE THOUGHTS' },
        }),
        JSON.stringify({
          id: 'ordinary',
          type: 'agent_notification_progress',
          created_at: '2026-10-19T10:00:00Z',
          content: { type: 'text', data: 'Reading the source page.' },
        }),
        JSON.stringify({
          id: 'reasoning-final',
          type: eventType,
          content: { type: 'application/guild-reasoning-progress', data: 'FINAL PRIVATE THOUGHTS', done: true },
        }),
        JSON.stringify({
          type: 'llm_done',
          created_at: '2026-10-19T10:00:01Z',
          body: JSON.stringify({ type: 'tool_use', id: 'check-1', name: 'finalize_linkedin_post' }),
        }),
      ];
      expect(publicLinkedinPayloads(payloads)).toHaveLength(2);
      const activity = linkedinRunActivity(payloads);
      expect(activity.map((row) => row.label)).toContain('Reading the source page.');
      expect(activity.find((row) => row.label === 'Reading the source page.')?.kind).toBe('reading');
      expect(activity.map((row) => row.label)).toContain('Checking the post options');
      expect(JSON.stringify(activity)).not.toContain('PRIVATE');
      expect(linkedinRunActivity(payloads, true).every((row) => row.status === 'done')).toBe(true);
    }
  );
});
