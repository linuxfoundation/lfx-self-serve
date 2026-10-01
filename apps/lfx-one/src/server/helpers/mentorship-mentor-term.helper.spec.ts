// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MentorshipUpstreamMentorProgramTerm } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { chooseMentorshipMentorTerm, mentorshipMentorTermStartMs } from './mentorship-mentor-term.helper';

const NOW = new Date('2026-09-17T12:00:00.000Z');

const term = (id: string, status: MentorshipUpstreamMentorProgramTerm['status'], start?: string): MentorshipUpstreamMentorProgramTerm => ({
  id,
  name: id,
  status,
  start_date_time: start,
});

describe('mentorshipMentorTermStartMs', () => {
  it('parses a start and treats a missing or bad one as none', () => {
    expect(mentorshipMentorTermStartMs({ start_date_time: '2026-09-01T00:00:00Z' })).toBe(Date.parse('2026-09-01T00:00:00Z'));
    expect(mentorshipMentorTermStartMs({})).toBeUndefined();
    expect(mentorshipMentorTermStartMs({ start_date_time: 'soon' })).toBeUndefined();
  });
});

describe('chooseMentorshipMentorTerm', () => {
  it('picks the open term that started most recently', () => {
    const terms = [
      term('spring', 'open', '2026-03-01T00:00:00Z'),
      term('fall', 'open', '2026-09-01T00:00:00Z'),
      term('winter', 'open', '2026-12-01T00:00:00Z'),
      term('summer', 'closed', '2026-06-01T00:00:00Z'),
    ];

    expect(chooseMentorshipMentorTerm(terms, NOW)?.id).toBe('fall');
  });

  it('skips open terms that have not started or have no start, and falls back to the latest closed term', () => {
    const terms = [
      term('next', 'open', '2026-12-01T00:00:00Z'),
      term('undated', 'open'),
      term('old', 'closed', '2025-01-01T00:00:00Z'),
      term('past', 'closed', '2026-01-01T00:00:00Z'),
    ];

    expect(chooseMentorshipMentorTerm(terms, NOW)?.id).toBe('past');
  });

  it('chooses nothing when the only open terms have not started and none is closed', () => {
    expect(chooseMentorshipMentorTerm([term('next', 'open', '2026-12-01T00:00:00Z'), term('undated', 'open')], NOW)).toBeUndefined();
  });

  it('picks the closed term that started most recently when no term is open', () => {
    const terms = [
      term('old', 'closed', '2025-03-01T00:00:00Z'),
      term('recent', 'closed', '2026-03-01T00:00:00Z'),
      term('gone', 'deleted', '2026-08-01T00:00:00Z'),
    ];

    expect(chooseMentorshipMentorTerm(terms, NOW)?.id).toBe('recent');
  });

  it('keeps the first of two terms with the same start', () => {
    const terms = [term('first', 'closed', '2026-03-01T00:00:00Z'), term('second', 'closed', '2026-03-01T00:00:00Z')];

    expect(chooseMentorshipMentorTerm(terms, NOW)?.id).toBe('first');
  });

  it('chooses nothing for a program with no terms, or only deleted ones', () => {
    expect(chooseMentorshipMentorTerm([], NOW)).toBeUndefined();
    expect(chooseMentorshipMentorTerm([term('gone', 'deleted', '2026-01-01T00:00:00Z')], NOW)).toBeUndefined();
  });
});
