// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { MentorshipUpstreamProgramApplicationRow, MentorshipUpstreamTask } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { mapMentorshipAdminApplicantRow, mapMentorshipProgramTask } from './mentorship-program-application.helper';

const task = (id: string, status: MentorshipUpstreamTask['status'], applicationId?: string): MentorshipUpstreamTask => ({
  id,
  application_id: applicationId,
  assignee_id: 'mentee',
  status,
  custom: false,
  created_on: '2026-08-01T00:00:00Z',
  updated_on: '2026-08-01T00:00:00Z',
});

describe('mapMentorshipProgramTask', () => {
  it('maps an upstream task to a detail row task', () => {
    expect(
      mapMentorshipProgramTask({
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
    expect(mapMentorshipProgramTask(task('t1', status, 'a1'))).toEqual({
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

const applicationRow = (overrides: Partial<MentorshipUpstreamProgramApplicationRow> = {}): MentorshipUpstreamProgramApplicationRow => ({
  user_id: 'u1',
  application_id: 'a1',
  status: 'accepted',
  name: 'Ada Mentee',
  email: 'ada@mentee.example',
  tasks_submitted: 1,
  tasks_total: 3,
  term: { id: 't1', name: 'Fall 2026', status: 'open' },
  created_on: '2026-08-01T10:00:00Z',
  updated_on: '2026-08-02T10:00:00Z',
  ...overrides,
});

describe('mapMentorshipAdminApplicantRow', () => {
  it('maps a row with its term id, term name and dates, and never sets tasks', () => {
    const mapped = mapMentorshipAdminApplicantRow(applicationRow({ avatar_url: 'https://cdn.example/a.png', note: 'Strong fit' }));

    expect(mapped).toEqual({
      id: 'a1',
      name: 'Ada Mentee',
      email: 'ada@mentee.example',
      status: 'accepted',
      tasksSubmitted: 1,
      tasksTotal: 3,
      termName: 'Fall 2026',
      termId: 't1',
      createdOn: '2026-08-01',
      updatedOn: '2026-08-02',
      avatarUrl: 'https://cdn.example/a.png',
      note: 'Strong fit',
    });
    expect(mapped.tasks).toBeUndefined();
  });

  it('reads an upstream hold as pending', () => {
    expect(mapMentorshipAdminApplicantRow(applicationRow({ status: 'hold' })).status).toBe('pending');
  });

  it('keeps other applications whose program id is a UUID and drops the rest', () => {
    const mapped = mapMentorshipAdminApplicantRow(
      applicationRow({
        other_applications: [
          { program_id: '3f2b8c1e-7a44-4d0e-9b55-0c1d2e3f4a5b', program_name: 'Program B', status: 'hold' },
          { program_id: 'not-a-uuid', program_name: 'Program C', status: 'accepted' },
        ],
      })
    );

    expect(mapped.otherApplications).toEqual([{ programId: '3f2b8c1e-7a44-4d0e-9b55-0c1d2e3f4a5b', programName: 'Program B', status: 'pending' }]);
  });

  it('omits otherApplications when none remain', () => {
    expect(mapMentorshipAdminApplicantRow(applicationRow()).otherApplications).toBeUndefined();
  });
});
