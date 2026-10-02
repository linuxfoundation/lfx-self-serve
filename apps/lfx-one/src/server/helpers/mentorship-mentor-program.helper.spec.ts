// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type {
  MentorshipMentorProgram,
  MentorshipUpstreamMentorProgram,
  MentorshipUpstreamMentorProgramTerm,
  MentorshipUpstreamProgramApplicationRow,
  MentorshipUpstreamTask,
} from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import {
  chooseMentorshipMentorProgramTerm,
  compareMentorshipMentorProgramCards,
  groupMentorshipMentorProgramTasks,
  mapMentorshipMentorProgramCard,
  mapMentorshipMentorProgramLists,
  mapMentorshipMentorProgramTask,
  sortMentorshipMentorProgramRows,
} from './mentorship-mentor-program.helper';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const OTHER_PROGRAM_ID = '1a2b3c4d-0000-4000-8000-000000000002';

const term = (id: string, status: MentorshipUpstreamMentorProgramTerm['status'], start?: string, end?: string): MentorshipUpstreamMentorProgramTerm => ({
  id,
  name: id,
  status,
  start_date_time: start,
  end_date_time: end,
});

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

describe('chooseMentorshipMentorProgramTerm', () => {
  it('picks the open term that started most recently as the active term', () => {
    const terms = [
      term('spring', 'open', '2026-03-01T00:00:00Z'),
      term('fall', 'open', '2026-09-01T00:00:00Z'),
      term('winter', 'open', '2026-12-01T00:00:00Z'),
    ];

    expect(chooseMentorshipMentorProgramTerm(terms, NOW)).toEqual({ term: terms[1], termStatus: 'active-term' });
  });

  it('prefers a started open term over a closed one that started later', () => {
    const terms = [term('fall', 'open', '2026-09-01T00:00:00Z'), term('late', 'closed', '2026-09-10T00:00:00Z')];

    expect(chooseMentorshipMentorProgramTerm(terms, NOW).term?.id).toBe('fall');
  });

  it('with only open terms that start later, picks the one that starts first as upcoming', () => {
    const terms = [term('spring-27', 'open', '2027-03-01T00:00:00Z'), term('undated', 'open'), term('winter', 'open', '2026-12-01T00:00:00Z')];

    expect(chooseMentorshipMentorProgramTerm(terms, NOW)).toEqual({ term: terms[2], termStatus: 'upcoming' });
  });

  it('prefers an upcoming open term over a closed one', () => {
    const terms = [term('summer', 'closed', '2026-06-01T00:00:00Z'), term('winter', 'open', '2026-12-01T00:00:00Z')];

    expect(chooseMentorshipMentorProgramTerm(terms, NOW)).toEqual({ term: terms[1], termStatus: 'upcoming' });
  });

  it('picks an undated open term as upcoming when it is the only open one', () => {
    const terms = [term('undated', 'open')];

    expect(chooseMentorshipMentorProgramTerm(terms, NOW)).toEqual({ term: terms[0], termStatus: 'upcoming' });
  });

  it('with no open term, picks the closed term that started most recently as completed', () => {
    const terms = [
      term('spring', 'closed', '2026-03-01T00:00:00Z'),
      term('summer', 'closed', '2026-06-01T00:00:00Z'),
      term('gone', 'deleted', '2026-08-01T00:00:00Z'),
    ];

    expect(chooseMentorshipMentorProgramTerm(terms, NOW)).toEqual({ term: terms[1], termStatus: 'completed' });
  });

  it('with no terms, or only deleted ones, chooses none and groups the card as upcoming', () => {
    expect(chooseMentorshipMentorProgramTerm([], NOW)).toEqual({ termStatus: 'upcoming' });
    expect(chooseMentorshipMentorProgramTerm([term('gone', 'deleted', '2026-08-01T00:00:00Z')], NOW)).toEqual({ termStatus: 'upcoming' });
  });
});

describe('sortMentorshipMentorProgramRows', () => {
  const applications = [
    application('a-accepted', 'accepted'),
    application('a-graduated', 'graduated'),
    application('a-pending', 'pending'),
    application('a-declined', 'declined'),
    application('a-withdrawn', 'withdrawn'),
    application('a-hold', 'hold'),
  ];

  it('counts accepted and graduated applications as mentees and every application as an applicant', () => {
    const rows = sortMentorshipMentorProgramRows(applications, []);

    expect(rows.mentees.map((row) => row.application_id)).toEqual(['a-accepted', 'a-graduated']);
    expect(rows.applicants).toHaveLength(6);
    expect(rows.applicants).not.toBe(applications);
  });

  it("counts only submitted tasks on an accepted mentee's application as tasks to review", () => {
    const tasks = [
      task('t-review', 'submitted', 'a-accepted'),
      task('t-in-progress', 'in_progress', 'a-accepted'),
      task('t-complete', 'complete', 'a-accepted'),
      task('t-graduated', 'submitted', 'a-graduated'),
      task('t-pending', 'submitted', 'a-pending'),
      task('t-elsewhere', 'submitted', 'a-unknown'),
      task('t-unlinked', 'submitted'),
    ];

    expect(sortMentorshipMentorProgramRows(applications, tasks).tasksToReview.map((row) => row.id)).toEqual(['t-review']);
  });
});

describe('mapMentorshipMentorProgramCard', () => {
  const program: MentorshipUpstreamMentorProgram = {
    id: 'program-1',
    name: 'GridFlow',
    slug: 'gridflow',
    logo_url: 'https://cdn.example.org/gridflow.png',
    skills: [],
    terms: [],
    mentors: [],
  };

  it("builds the card from the program, its project, the chosen term's dates and the row counts", () => {
    const fall = term('Fall 2026', 'open', '2026-09-01T00:00:00Z', '2026-12-15T23:59:59Z');
    const rows = sortMentorshipMentorProgramRows([application('a1', 'accepted'), application('a2', 'pending')], [task('t1', 'submitted', 'a1')]);

    expect(mapMentorshipMentorProgramCard(program, { project_name: ' LF Energy ' }, { term: fall, termStatus: 'active-term' }, rows)).toEqual({
      id: 'program-1',
      slug: 'gridflow',
      name: 'GridFlow',
      projectName: 'LF Energy',
      term: 'Fall 2026',
      termStatus: 'active-term',
      stats: { mentees: 1, tasksToReview: 1, applicants: 2 },
      logoUrl: 'https://cdn.example.org/gridflow.png',
      termStartDate: '2026-09-01',
      termEndDate: '2026-12-15',
    });
  });

  it('leaves out what the program or its term does not have', () => {
    const card = mapMentorshipMentorProgramCard({ ...program, logo_url: undefined }, {}, { termStatus: 'upcoming' }, sortMentorshipMentorProgramRows([], []));

    expect(card).toEqual({
      id: 'program-1',
      slug: 'gridflow',
      name: 'GridFlow',
      projectName: '',
      term: '',
      termStatus: 'upcoming',
      stats: { mentees: 0, tasksToReview: 0, applicants: 0 },
    });
  });

  it('keeps the calendar date a term date was written with, whatever its offset', () => {
    const card = mapMentorshipMentorProgramCard(
      program,
      {},
      { term: term('x', 'open', '2026-09-01T00:00:00+05:00', '2026-12-15T20:00:00-08:00'), termStatus: 'active-term' },
      sortMentorshipMentorProgramRows([], [])
    );

    expect(card.termStartDate).toBe('2026-09-01');
    expect(card.termEndDate).toBe('2026-12-15');
  });

  it('drops a term date that does not parse', () => {
    const card = mapMentorshipMentorProgramCard(
      program,
      {},
      { term: term('x', 'open', 'soon'), termStatus: 'upcoming' },
      sortMentorshipMentorProgramRows([], [])
    );

    expect(card.termStartDate).toBeUndefined();
    expect(card.termEndDate).toBeUndefined();
  });
});

describe('compareMentorshipMentorProgramCards', () => {
  const card = (name: string, termStatus: MentorshipMentorProgram['termStatus']): MentorshipMentorProgram => ({
    id: name,
    slug: name,
    name,
    projectName: '',
    term: '',
    termStatus,
    stats: { mentees: 0, tasksToReview: 0, applicants: 0 },
  });

  it('orders active terms, then upcoming, then completed, each by name', () => {
    const cards = [card('Zeta', 'completed'), card('Beta', 'upcoming'), card('Alpha', 'completed'), card('Gamma', 'active-term'), card('Delta', 'active-term')];

    expect([...cards].sort(compareMentorshipMentorProgramCards).map((row) => row.name)).toEqual(['Delta', 'Gamma', 'Beta', 'Alpha', 'Zeta']);
  });
});

describe('mapMentorshipMentorProgramTask', () => {
  it('maps an upstream task to a detail row task', () => {
    expect(
      mapMentorshipMentorProgramTask({
        ...task('t1', 'in_progress', 'a1'),
        name: 'Resume',
        description: 'Upload your resume.',
        category: 'prerequisite',
        file: 'resume.pdf',
        submit_file: 'yes',
        due_date: '2026-09-30T00:00:00Z',
      })
    ).toEqual({
      id: 't1',
      name: 'Resume',
      description: 'Upload your resume.',
      status: 'in-progress',
      prerequisite: true,
      createdOn: '2026-08-01T00:00:00Z',
      updatedOn: '2026-08-01T00:00:00Z',
      dueOn: '2026-09-30',
      hasSubmission: true,
      requiresFileSubmission: true,
    });
  });

  it.each([
    ['incomplete', 'pending'],
    ['submitted', 'submitted'],
    ['complete', 'completed'],
  ] as const)('maps the upstream %s status to %s, with no name, file or due date', (status, expected) => {
    expect(mapMentorshipMentorProgramTask(task('t1', status, 'a1'))).toEqual({
      id: 't1',
      name: '',
      description: '',
      status: expected,
      prerequisite: false,
      createdOn: '2026-08-01T00:00:00Z',
      updatedOn: '2026-08-01T00:00:00Z',
      hasSubmission: false,
      requiresFileSubmission: false,
    });
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
      'Fall 2026',
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
      'Fall 2026',
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

  it("falls back to the chosen term's name and empty strings, and leaves tasks out when they were not read", () => {
    const [applicant] = mapMentorshipMentorProgramLists([row('a1', 'pending')], 'Fall 2026', new Map()).applicants;

    expect(applicant).toEqual({
      id: 'a1',
      name: '',
      email: '',
      status: 'pending',
      tasksSubmitted: 0,
      tasksTotal: 0,
      termName: 'Fall 2026',
      createdOn: '2026-08-01',
      updatedOn: '2026-08-01',
      otherApplications: [],
    });
  });
});
