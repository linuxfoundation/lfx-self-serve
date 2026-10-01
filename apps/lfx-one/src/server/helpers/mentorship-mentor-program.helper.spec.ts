// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
  mapMentorshipMentorProgramCard,
  sortMentorshipMentorProgramRows,
} from './mentorship-mentor-program.helper';

const NOW = new Date('2026-09-17T12:00:00.000Z');

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
