// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipUpstreamProgramMembership, MentorshipUpstreamProgramMemberStatus } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { ServiceValidationError } from '../errors';
import {
  escapeMentorshipIlikeSearch,
  mapMentorshipMentorInvitations,
  mapMentorshipMentorOpenProgram,
  mapMentorshipMentorProgramRequests,
  parseMentorshipMentorOpenProgramsQuery,
} from './mentorship-mentor-request.helper';

const membership: MentorshipUpstreamProgramMembership = {
  id: 'member-1',
  program_id: 'prog-1',
  program_name: 'Test Program',
  member_type: 'mentor',
  status: 'requested',
  created_on: '2026-06-28T10:00:00Z',
  updated_on: '2026-06-29T10:00:00Z',
};

describe('mapMentorshipMentorOpenProgram', () => {
  it('keeps only the id and name the picker shows', () => {
    expect(mapMentorshipMentorOpenProgram({ id: 'prog-1', name: 'Test Program', status: 'published', project_name: 'Test Project' })).toEqual({
      id: 'prog-1',
      name: 'Test Program',
    });
  });
});

describe('parseMentorshipMentorOpenProgramsQuery', () => {
  it('reads a trimmed search and an integer offset', () => {
    expect(parseMentorshipMentorOpenProgramsQuery({ search: '  kube ', offset: '40' })).toEqual({ search: 'kube', offset: 40 });
  });

  it('leaves out a missing or blank value', () => {
    expect(parseMentorshipMentorOpenProgramsQuery({})).toEqual({});
    expect(parseMentorshipMentorOpenProgramsQuery({ search: '   ', offset: '' })).toEqual({});
  });

  it.each(['-1', '1.5', 'abc', '1e3', '99999999999999999999'])('refuses the offset %j', (offset) => {
    expect(() => parseMentorshipMentorOpenProgramsQuery({ offset })).toThrow(ServiceValidationError);
  });

  it('refuses a search over the length limit, but takes one at it', () => {
    expect(() => parseMentorshipMentorOpenProgramsQuery({ search: 'a'.repeat(101) })).toThrow(ServiceValidationError);
    expect(parseMentorshipMentorOpenProgramsQuery({ search: 'a'.repeat(100) })).toEqual({ search: 'a'.repeat(100) });
  });

  it('ignores a repeated value rather than reading an array', () => {
    expect(parseMentorshipMentorOpenProgramsQuery({ search: ['a', 'b'], offset: ['1', '2'] })).toEqual({});
  });
});

describe('escapeMentorshipIlikeSearch', () => {
  it('escapes the ILIKE wildcards and the escape character, so the search is literal', () => {
    expect(escapeMentorshipIlikeSearch('100%_ok\\')).toBe('100\\%\\_ok\\\\');
  });

  it('leaves a plain search alone', () => {
    expect(escapeMentorshipIlikeSearch('Kubernetes Contributors')).toBe('Kubernetes Contributors');
  });
});

describe('mapMentorshipMentorProgramRequests', () => {
  it('maps the membership id and its program', () => {
    expect(mapMentorshipMentorProgramRequests([membership])).toEqual([{ id: 'member-1', programId: 'prog-1', programName: 'Test Program', status: 'pending' }]);
  });

  it.each<[MentorshipUpstreamProgramMemberStatus, string]>([
    ['requested', 'pending'],
    ['pending', 'pending'],
    ['approved', 'approved'],
    ['declined', 'declined'],
    ['withdrawn', 'withdrawn'],
  ])('reads an upstream %s membership as %s', (status, expected) => {
    expect(mapMentorshipMentorProgramRequests([{ ...membership, status }])[0]?.status).toBe(expected);
  });

  it('drops invited rows and rows with no status, keeping the order of the rest', () => {
    const rows = mapMentorshipMentorProgramRequests([
      { ...membership, id: 'member-1', status: 'invited' },
      { ...membership, id: 'member-2', status: 'approved' },
      { ...membership, id: 'member-3', status: undefined },
      { ...membership, id: 'member-4', status: 'withdrawn' },
    ]);
    expect(rows.map((row) => row.id)).toEqual(['member-2', 'member-4']);
  });

  it('drops a legacy active row, a status upstream no longer stores', () => {
    const legacy = { ...membership, status: 'active' } as unknown as MentorshipUpstreamProgramMembership;

    expect(mapMentorshipMentorProgramRequests([legacy])).toEqual([]);
  });
});

describe('mapMentorshipMentorInvitations', () => {
  it('maps each invited row only, with its id and program', () => {
    const invitations = mapMentorshipMentorInvitations([
      { ...membership, id: 'member-1', program_id: 'prog-1', program_name: 'Program 1', status: 'invited' },
      { ...membership, id: 'member-2', program_id: 'prog-2', status: 'requested' },
      { ...membership, id: 'member-3', program_id: 'prog-3', program_name: 'Program 3', status: 'invited' },
      { ...membership, id: 'member-4', program_id: 'prog-4', status: undefined },
    ]);
    expect(invitations).toEqual([
      { id: 'member-1', programId: 'prog-1', programName: 'Program 1' },
      { id: 'member-3', programId: 'prog-3', programName: 'Program 3' },
    ]);
  });
});
