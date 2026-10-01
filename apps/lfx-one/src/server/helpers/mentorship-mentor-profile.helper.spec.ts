// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MentorshipUpstreamMentorDetail, MentorshipUpstreamMentorMentee, MentorshipUpstreamMentorProgram } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { mapMentorshipMentoringHistory, mapMentorshipMentorProfileDetails } from './mentorship-mentor-profile.helper';

const NOW = new Date('2026-09-17T12:00:00.000Z');

const program = (name: string, terms: MentorshipUpstreamMentorProgram['terms']): MentorshipUpstreamMentorProgram => ({
  id: `program-${name}`,
  name,
  slug: name.toLowerCase(),
  skills: [],
  mentors: [],
  terms,
});

const mentee = (
  userId: string,
  programName: string,
  termName: string,
  status: MentorshipUpstreamMentorMentee['status'] = 'active'
): MentorshipUpstreamMentorMentee => ({
  user_id: userId,
  program_name: programName,
  term_name: termName,
  status,
});

const detail = (overrides: Partial<MentorshipUpstreamMentorDetail>): MentorshipUpstreamMentorDetail => ({
  user_id: '6f1c2d3e-4a5b-4c6d-8e7f-901234567890',
  skills: [],
  joined_at: '2026-01-01T00:00:00Z',
  programs: [],
  current_mentees: [],
  graduated_mentees: [],
  stats: { programs_mentoring: 0, current_mentees: 0, mentees_graduated: 0 },
  ...overrides,
});

describe('mapMentorshipMentorProfileDetails', () => {
  it('maps the introduction and skills of the mentor row', () => {
    expect(
      mapMentorshipMentorProfileDetails({
        introduction: '<p>Hello</p>',
        skill_set: { skills: ['Go', '', 'Rust'], comments: 'ignored' },
      } as never)
    ).toEqual({ aboutMe: '<p>Hello</p>', skills: ['Go', 'Rust'] });
  });

  it('defaults a row with no introduction or skills to empty fields', () => {
    expect(mapMentorshipMentorProfileDetails({ skill_set: 'bad' } as never)).toEqual({ aboutMe: '', skills: [] });
  });
});

describe('mapMentorshipMentoringHistory', () => {
  it('is empty without a mentor detail', () => {
    expect(mapMentorshipMentoringHistory(undefined, NOW)).toEqual([]);
  });

  it('groups mentees by program and term name and counts each mentee once', () => {
    const history = mapMentorshipMentoringHistory(
      detail({
        programs: [
          program('GridFlow', [
            { id: 'fall', name: 'Fall 2026', status: 'open', start_date_time: '2026-09-01T00:00:00Z' },
            { id: 'spring', name: 'Spring 2026', status: 'closed', start_date_time: '2026-03-01T00:00:00Z' },
          ]),
        ],
        current_mentees: [mentee('m1', 'GridFlow', 'Fall 2026'), mentee('m2', 'GridFlow', 'Fall 2026', 'accepted')],
        graduated_mentees: [mentee('m1', 'GridFlow', 'Fall 2026', 'graduated'), mentee('m3', 'GridFlow', 'Spring 2026', 'graduated')],
      }),
      NOW
    );

    expect(history).toEqual([
      { id: 'fall', programName: 'GridFlow', term: 'Fall 2026', menteesCount: 2, status: 'in-progress' },
      { id: 'spring', programName: 'GridFlow', term: 'Spring 2026', menteesCount: 1, status: 'completed' },
    ]);
  });

  it("lists each program's chosen term even when it has no mentees", () => {
    const history = mapMentorshipMentoringHistory(
      detail({
        programs: [
          program('Ledger', [{ id: 'fall', name: 'Fall 2026', status: 'open', start_date_time: '2026-09-01T00:00:00Z' }]),
          program('Archive', [{ id: 'old', name: 'Fall 2025', status: 'closed', start_date_time: '2025-09-01T00:00:00Z' }]),
          program('Empty', []),
        ],
      }),
      NOW
    );

    expect(history).toEqual([
      { id: 'fall', programName: 'Ledger', term: 'Fall 2026', menteesCount: 0, status: 'in-progress' },
      { id: 'old', programName: 'Archive', term: 'Fall 2025', menteesCount: 0, status: 'completed' },
    ]);
  });

  it('does not list an open term that has not started as in progress', () => {
    const history = mapMentorshipMentoringHistory(
      detail({
        programs: [
          program('Ledger', [
            { id: 'winter', name: 'Winter 2026', status: 'open', start_date_time: '2026-12-01T00:00:00Z' },
            { id: 'spring', name: 'Spring 2026', status: 'closed', start_date_time: '2026-03-01T00:00:00Z' },
          ]),
          program('Upcoming', [{ id: 'next', name: 'Winter 2026', status: 'open', start_date_time: '2026-12-01T00:00:00Z' }]),
        ],
      }),
      NOW
    );

    expect(history).toEqual([{ id: 'spring', programName: 'Ledger', term: 'Spring 2026', menteesCount: 0, status: 'completed' }]);
  });

  it('falls back to the mentees for the status, and a generated id, when no term matches', () => {
    const history = mapMentorshipMentoringHistory(
      detail({
        current_mentees: [mentee('m1', 'Renamed', 'Fall 2026')],
        graduated_mentees: [mentee('m2', 'Retired', 'Spring 2024', 'graduated')],
      }),
      NOW
    );

    expect(history).toEqual([
      { id: 'history-1', programName: 'Renamed', term: 'Fall 2026', menteesCount: 1, status: 'in-progress' },
      { id: 'history-2', programName: 'Retired', term: 'Spring 2024', menteesCount: 1, status: 'completed' },
    ]);
  });

  it('generates the id when two programs share a name and a term name', () => {
    const history = mapMentorshipMentoringHistory(
      detail({
        programs: [
          program('Twin', [{ id: 'a', name: 'Fall 2026', status: 'open', start_date_time: '2026-09-01T00:00:00Z' }]),
          { ...program('Twin', [{ id: 'b', name: 'Fall 2026', status: 'closed', start_date_time: '2025-09-01T00:00:00Z' }]), id: 'program-twin-2' },
        ],
      }),
      NOW
    );

    expect(history).toEqual([{ id: 'history-1', programName: 'Twin', term: 'Fall 2026', menteesCount: 0, status: 'in-progress' }]);
  });

  it('orders in-progress rows first, then the latest start, then by name', () => {
    const history = mapMentorshipMentoringHistory(
      detail({
        programs: [
          program('Beta', [
            { id: 'beta-old', name: 'Spring 2025', status: 'closed', start_date_time: '2025-03-01T00:00:00Z' },
            { id: 'beta-now', name: 'Fall 2026', status: 'open', start_date_time: '2026-09-01T00:00:00Z' },
          ]),
          program('Alpha', [{ id: 'alpha-now', name: 'Fall 2026', status: 'open', start_date_time: '2026-09-01T00:00:00Z' }]),
          program('Gamma', [{ id: 'gamma-old', name: 'Fall 2025', status: 'closed', start_date_time: '2025-09-01T00:00:00Z' }]),
        ],
        graduated_mentees: [mentee('m1', 'Beta', 'Spring 2025', 'graduated'), mentee('m2', 'Undated', 'Someday', 'graduated')],
      }),
      NOW
    );

    expect(history.map((row) => row.id)).toEqual(['alpha-now', 'beta-now', 'gamma-old', 'beta-old', 'history-5']);
  });
});
