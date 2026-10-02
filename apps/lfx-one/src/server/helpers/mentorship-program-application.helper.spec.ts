// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { MentorshipUpstreamTask } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { mapMentorshipProgramTask } from './mentorship-program-application.helper';

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
