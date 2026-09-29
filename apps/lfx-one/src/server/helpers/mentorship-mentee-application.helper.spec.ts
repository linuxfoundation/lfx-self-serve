// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The helper imports the shared utils barrel, which transitively reaches Angular's
// partially-compiled @angular/common and needs the JIT compiler under vitest.
import '@angular/compiler';

import { MentorshipUpstreamApplication, MentorshipUpstreamTask } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import {
  mapMentorshipMenteeApplication,
  mapMentorshipMenteeApplicationHistory,
  mapMentorshipMenteeApplicationTask,
} from './mentorship-mentee-application.helper';

const baseTask: MentorshipUpstreamTask = {
  id: 'task-1',
  assignee_id: 'user-1',
  name: 'Test task',
  description: 'Test task description.',
  category: 'prerequisite',
  status: 'incomplete',
  custom: false,
  created_on: '2026-06-01T10:00:00Z',
  updated_on: '2026-06-05T10:00:00Z',
};

const baseApplication: MentorshipUpstreamApplication = {
  id: 'app-1',
  program_term_id: 'term-1',
  user_id: 'user-1',
  role: 'mentee',
  status: 'pending',
  tasks_submitted: false,
  admin_notified: false,
  created_on: '2026-06-28T10:00:00Z',
  updated_on: '2026-06-29T10:00:00Z',
  program: { id: 'prog-1', name: 'Test Program', slug: 'test-program', logo_url: 'https://example.com/logo.png', project_name: 'Test Project' },
  term: { id: 'term-1', name: 'Fall 2026', status: 'open', application_end_date: '2026-08-01' },
};

describe('mapMentorshipMenteeApplicationTask', () => {
  it('maps an open task with no submission', () => {
    expect(mapMentorshipMenteeApplicationTask(baseTask, '2026-08-01')).toEqual({
      id: 'task-1',
      name: 'Test task',
      description: 'Test task description.',
      category: 'prerequisite',
      status: 'incomplete',
      submitFile: null,
      fileUrl: undefined,
      dueDate: '2026-08-01T00:00:00Z',
      submittedOn: undefined,
      updatedOn: '2026-06-05T10:00:00Z',
    });
  });

  it('uses the last update as the submission time for a submitted or completed task', () => {
    expect(mapMentorshipMenteeApplicationTask({ ...baseTask, status: 'submitted' }, '2026-08-01').submittedOn).toBe('2026-06-05T10:00:00Z');
    expect(mapMentorshipMenteeApplicationTask({ ...baseTask, status: 'complete' }, '2026-08-01').submittedOn).toBe('2026-06-05T10:00:00Z');
    expect(mapMentorshipMenteeApplicationTask({ ...baseTask, status: 'in_progress' }, '2026-08-01').submittedOn).toBeUndefined();
  });

  it('maps the file fields, and the due date as its UTC midnight instant, when set', () => {
    const task = mapMentorshipMenteeApplicationTask(
      {
        ...baseTask,
        submit_file: 'required',
        file: 'https://example.com/files/answer.pdf',
        due_date: '2026-07-15',
      },
      '2026-08-01'
    );
    expect(task).toMatchObject({ submitFile: 'required', fileUrl: 'https://example.com/files/answer.pdf', dueDate: '2026-07-15T00:00:00Z' });
  });

  it('gives a non-prerequisite task without its own due date no due date', () => {
    expect(mapMentorshipMenteeApplicationTask({ ...baseTask, category: 'non_prerequisite' }, '2026-08-01').dueDate).toBeUndefined();
  });

  it('defaults a missing name, description and category', () => {
    const task = mapMentorshipMenteeApplicationTask(
      { ...baseTask, name: undefined, description: undefined, category: undefined, submit_file: '' },
      '2026-08-01'
    );
    expect(task).toMatchObject({ name: '', description: '', category: 'non_prerequisite', submitFile: null });
  });
});

describe('mapMentorshipMenteeApplication', () => {
  it('maps the application, its tasks, and the project from the embedded program', () => {
    const result = mapMentorshipMenteeApplication(baseApplication, [baseTask]);

    expect(result).toEqual({
      id: 'app-1',
      programId: 'prog-1',
      programName: 'Test Program',
      programLogoUrl: 'https://example.com/logo.png',
      projectName: 'Test Project',
      term: { id: 'term-1', name: 'Fall 2026' },
      upstreamStatus: 'pending',
      createdOn: '2026-06-28T10:00:00Z',
      updatedOn: '2026-06-29T10:00:00Z',
      decisionExpectedDate: '2026-08-01T00:00:00Z',
      tasks: [mapMentorshipMenteeApplicationTask(baseTask, '2026-08-01')],
    });
  });

  it('leaves the project out when the program has none', () => {
    const noProject = { ...baseApplication, program: { id: 'prog-1', name: 'Test Program', slug: 'test-program', project_name: '' } };
    expect(mapMentorshipMenteeApplication(noProject, []).projectName).toBeUndefined();
    expect(mapMentorshipMenteeApplication({ ...baseApplication, program: undefined }, []).projectName).toBeUndefined();
  });

  it('leaves tasks out when they were not read, and keeps an empty list when none are assigned', () => {
    expect(mapMentorshipMenteeApplication(baseApplication, undefined)).not.toHaveProperty('tasks');
    expect(mapMentorshipMenteeApplication(baseApplication, []).tasks).toEqual([]);
  });

  it('falls back to the term id on the row when the term is not embedded', () => {
    const result = mapMentorshipMenteeApplication({ ...baseApplication, program: undefined, term: undefined }, []);
    expect(result).toMatchObject({ programId: '', programName: '', term: { id: 'term-1', name: '' }, decisionExpectedDate: undefined });
  });
});

describe('mapMentorshipMenteeApplicationHistory', () => {
  it('maps the applications newest first with a formatted submission date', () => {
    const history = mapMentorshipMenteeApplicationHistory([
      { ...baseApplication, id: 'older', status: 'declined', created_on: '2026-01-10T10:00:00Z' },
      baseApplication,
    ]);

    expect(history).toEqual([
      { id: 'app-1', programName: 'Test Program', termName: 'Fall 2026', submittedOn: 'Jun 28, 2026', status: 'pending' },
      { id: 'older', programName: 'Test Program', termName: 'Fall 2026', submittedOn: 'Jan 10, 2026', status: 'declined' },
    ]);
  });

  it('lists graduated, then accepted, then pending, then every other status, newest first within each', () => {
    const history = mapMentorshipMenteeApplicationHistory([
      { ...baseApplication, id: 'withdrawn', status: 'withdrawn', created_on: '2026-07-01T10:00:00Z' },
      { ...baseApplication, id: 'pending-old', status: 'pending', created_on: '2026-02-01T10:00:00Z' },
      { ...baseApplication, id: 'declined', status: 'declined', created_on: '2026-05-01T10:00:00Z' },
      { ...baseApplication, id: 'accepted', status: 'accepted', created_on: '2026-03-01T10:00:00Z' },
      { ...baseApplication, id: 'pending-new', status: 'pending', created_on: '2026-06-01T10:00:00Z' },
      { ...baseApplication, id: 'graduated', status: 'graduated', created_on: '2025-01-01T10:00:00Z' },
      { ...baseApplication, id: 'hold', status: 'hold', created_on: '2026-04-01T10:00:00Z' },
    ]);

    expect(history.map((entry) => entry.id)).toEqual(['graduated', 'accepted', 'pending-new', 'pending-old', 'withdrawn', 'declined', 'hold']);
  });
});
