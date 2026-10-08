// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { MentorshipUpstreamMentoredProgram, MentorshipUpstreamProgramApplicationRow, MentorshipUpstreamTask } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import {
  groupMentorshipMentorProgramTasks,
  mapMentorshipMentorProgram,
  mapMentorshipMentorProgramLists,
  mentorshipMentorProgramTermIds,
} from './mentorship-mentor-program.helper';

const OTHER_PROGRAM_ID = '1a2b3c4d-0000-4000-8000-000000000002';

const application = (id: string, status: MentorshipUpstreamProgramApplicationRow['status']): MentorshipUpstreamProgramApplicationRow => ({
  user_id: `user-${id}`,
  application_id: id,
  status,
  tasks_submitted: 0,
  tasks_total: 0,
  created_on: '2026-08-01T00:00:00Z',
  updated_on: '2026-08-01T00:00:00Z',
});

const task = (id: string, status: MentorshipUpstreamTask['status'], applicationId?: string): MentorshipUpstreamTask => ({
  id,
  application_id: applicationId,
  assignee_id: 'mentee',
  status,
  custom: false,
  created_on: '2026-08-01T00:00:00Z',
  updated_on: '2026-08-01T00:00:00Z',
});

describe('mapMentorshipMentorProgram', () => {
  const item: MentorshipUpstreamMentoredProgram = {
    id: 'program-1',
    slug: 'gridflow',
    name: 'GridFlow',
    project_name: ' LF Energy ',
    logo_url: 'https://cdn.example.org/gridflow.png',
    status: 'open',
    stats: { mentees: 3, applicants: 7, tasks_to_review: 2 },
  };

  it("builds the card from the upstream row, with upstream's status and program-wide counts", () => {
    expect(mapMentorshipMentorProgram(item)).toEqual({
      program: {
        id: 'program-1',
        slug: 'gridflow',
        name: 'GridFlow',
        projectName: 'LF Energy',
        status: 'open',
        stats: { mentees: 3, tasksToReview: 2, applicants: 7 },
        logoUrl: 'https://cdn.example.org/gridflow.png',
      },
      unknownStatus: false,
    });
  });

  it('keeps a completed status', () => {
    expect(mapMentorshipMentorProgram({ ...item, status: 'completed' })).toEqual({
      program: expect.objectContaining({ status: 'completed' }),
      unknownStatus: false,
    });
  });

  it('shows a status it does not know as open and flags it', () => {
    expect(mapMentorshipMentorProgram({ ...item, status: 'archived' })).toEqual({
      program: expect.objectContaining({ status: 'open' }),
      unknownStatus: true,
    });
  });

  it('falls back to the id for the slug and leaves out what the row does not have', () => {
    const { program } = mapMentorshipMentorProgram({ ...item, slug: undefined, project_name: undefined, logo_url: undefined });

    expect(program).toEqual({
      id: 'program-1',
      slug: 'program-1',
      name: 'GridFlow',
      projectName: '',
      status: 'open',
      stats: { mentees: 3, tasksToReview: 2, applicants: 7 },
    });
  });

  it('falls back to the id for an empty slug and drops an empty logo', () => {
    const { program } = mapMentorshipMentorProgram({ ...item, slug: '', logo_url: '' });

    expect(program.slug).toBe('program-1');
    expect(program).not.toHaveProperty('logoUrl');
  });
});

describe('mentorshipMentorProgramTermIds', () => {
  const onTerm = (id: string, termId?: string): MentorshipUpstreamProgramApplicationRow => ({
    ...application(id, 'accepted'),
    ...(termId === undefined ? {} : { term: { id: termId, name: termId, status: 'open' as const } }),
  });

  it('lists each term an application is on once, in the order first seen, skipping applications with no term', () => {
    expect(mentorshipMentorProgramTermIds([onTerm('a1', 'term-b'), onTerm('a2', 'term-a'), onTerm('a3'), onTerm('a4', 'term-b')])).toEqual([
      'term-b',
      'term-a',
    ]);
  });

  it('keeps a term whose id is empty, so the UUID check refuses it', () => {
    expect(mentorshipMentorProgramTermIds([onTerm('a1', 'term-a'), onTerm('a2', '')])).toEqual(['term-a', '']);
  });

  it('lists no terms for no applications', () => {
    expect(mentorshipMentorProgramTermIds([])).toEqual([]);
  });
});

describe('groupMentorshipMentorProgramTasks', () => {
  it("groups tasks by application, starting every listed application with none and dropping any other application's tasks", () => {
    const grouped = groupMentorshipMentorProgramTasks(
      ['a1', 'a2'],
      [task('t1', 'submitted', 'a1'), task('t2', 'submitted', 'mentor-app'), task('t3', 'complete', 'a1'), task('t4', 'submitted')]
    );

    expect([...grouped.entries()].map(([id, tasks]) => [id, tasks.map((row) => row.id)])).toEqual([
      ['a1', ['t1', 't3']],
      ['a2', []],
    ]);
  });
});

describe('mapMentorshipMentorProgramLists', () => {
  const row = (
    id: string,
    status: MentorshipUpstreamProgramApplicationRow['status'],
    overrides: Partial<MentorshipUpstreamProgramApplicationRow> = {}
  ): MentorshipUpstreamProgramApplicationRow => ({ ...application(id, status), ...overrides });

  it('makes every application an applicant and the accepted and graduated ones mentees, keyed by application id', () => {
    const lists = mapMentorshipMentorProgramLists(
      [row('a1', 'accepted'), row('a2', 'graduated'), row('a3', 'pending'), row('a4', 'hold'), row('a5', 'declined')],
      new Map()
    );

    expect(lists.mentees.map((mentee) => [mentee.id, mentee.status])).toEqual([
      ['a1', 'accepted'],
      ['a2', 'graduated'],
    ]);
    // `hold` has no UI status and shows as pending (H4).
    expect(lists.applicants.map((applicant) => [applicant.id, applicant.status])).toEqual([
      ['a1', 'accepted'],
      ['a2', 'graduated'],
      ['a3', 'pending'],
      ['a4', 'pending'],
      ['a5', 'declined'],
    ]);
  });

  it('maps a row with every field, reducing other applications to program name and status', () => {
    const lists = mapMentorshipMentorProgramLists(
      [
        row('a1', 'accepted', {
          name: 'Ifeoma Adeyemi',
          email: 'ifeoma@example.com',
          avatar_url: 'https://avatars.example.com/a1.png',
          note: 'Strong start.',
          tasks_submitted: 1,
          tasks_total: 2,
          term: { id: 'term-1', name: 'Summer 2026', status: 'closed' },
          created_on: '2026-08-01T10:00:00Z',
          updated_on: '2026-08-02T10:00:00Z',
          other_applications: [
            { program_id: OTHER_PROGRAM_ID, program_name: 'Thanos', status: 'accepted' },
            { program_id: 'program-3', program_name: 'Apicurio', status: 'hold' },
          ],
        }),
      ],
      new Map([['a1', [task('t1', 'submitted', 'a1')]]])
    );

    const mentee = {
      id: 'a1',
      name: 'Ifeoma Adeyemi',
      email: 'ifeoma@example.com',
      avatarUrl: 'https://avatars.example.com/a1.png',
      status: 'accepted',
      tasksSubmitted: 1,
      tasksTotal: 2,
      termName: 'Summer 2026',
      note: 'Strong start.',
      tasks: [expect.objectContaining({ id: 't1', status: 'submitted' })],
    };
    expect(lists.mentees).toEqual([mentee]);
    expect(lists.applicants).toEqual([
      {
        ...mentee,
        createdOn: '2026-08-01',
        updatedOn: '2026-08-02',
        // A program id that is not a UUID is dropped, so that name shows without a link.
        otherApplications: [
          { programId: OTHER_PROGRAM_ID, programName: 'Thanos', status: 'accepted' },
          { programName: 'Apicurio', status: 'pending' },
        ],
      },
    ]);
  });

  it("takes each row's term from its own application", () => {
    const lists = mapMentorshipMentorProgramLists(
      [
        row('a1', 'accepted', { term: { id: 'term-1', name: 'Summer 2026', status: 'closed' } }),
        row('a2', 'accepted', { term: { id: 'term-2', name: 'Fall 2026', status: 'open' } }),
      ],
      new Map()
    );

    expect(lists.mentees.map((mentee) => [mentee.id, mentee.termName])).toEqual([
      ['a1', 'Summer 2026'],
      ['a2', 'Fall 2026'],
    ]);
  });

  it('falls back to empty strings when the application has no term or details, and leaves tasks out when they were not read', () => {
    const [applicant] = mapMentorshipMentorProgramLists([row('a1', 'pending')], new Map()).applicants;

    expect(applicant).toEqual({
      id: 'a1',
      name: '',
      email: '',
      status: 'pending',
      tasksSubmitted: 0,
      tasksTotal: 0,
      termName: '',
      createdOn: '2026-08-01',
      updatedOn: '2026-08-01',
      otherApplications: [],
    });
  });
});
