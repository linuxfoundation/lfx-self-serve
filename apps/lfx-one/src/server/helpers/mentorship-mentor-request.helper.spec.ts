// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipUpstreamProgramMembership, MentorshipUpstreamProgramMemberStatus } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { mapMentorshipMentorOpenProgram, mapMentorshipMentorProgramRequests } from './mentorship-mentor-request.helper';

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

describe('mapMentorshipMentorProgramRequests', () => {
  it('maps the membership id and its program', () => {
    expect(mapMentorshipMentorProgramRequests([membership])).toEqual([{ id: 'member-1', programId: 'prog-1', programName: 'Test Program', status: 'pending' }]);
  });

  it.each<[MentorshipUpstreamProgramMemberStatus, string]>([
    ['requested', 'pending'],
    ['pending', 'pending'],
    ['active', 'accepted'],
    ['declined', 'declined'],
    ['withdrawn', 'withdrawn'],
  ])('reads an upstream %s membership as %s', (status, expected) => {
    expect(mapMentorshipMentorProgramRequests([{ ...membership, status }])[0]?.status).toBe(expected);
  });

  it('drops invited rows and rows with no status, keeping the order of the rest', () => {
    const rows = mapMentorshipMentorProgramRequests([
      { ...membership, id: 'member-1', status: 'invited' },
      { ...membership, id: 'member-2', status: 'active' },
      { ...membership, id: 'member-3', status: undefined },
      { ...membership, id: 'member-4', status: 'withdrawn' },
    ]);
    expect(rows.map((row) => row.id)).toEqual(['member-2', 'member-4']);
  });
});
