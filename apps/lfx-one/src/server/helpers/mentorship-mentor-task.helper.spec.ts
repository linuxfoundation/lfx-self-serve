// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The shared utils barrel reaches Angular's partially-compiled packages, which need the JIT compiler under vitest.
import '@angular/compiler';

import { MENTORSHIP_TASK_DESCRIPTION_MAX, MENTORSHIP_TASK_NAME_MAX } from '@lfx-one/shared/constants';
import { MentorshipUpstreamApplication } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS } from '../constants/mentorship.constants';
import { ServiceValidationError } from '../errors';
import {
  buildMentorshipUpstreamTaskCreate,
  isMentorshipTaskAssignableApplication,
  parseMentorshipMentorTaskCreateRequest,
} from './mentorship-mentor-task.helper';

const APPLICATION_ID = '5d1c8e2f-3a4b-4c6d-8e9f-0a1b2c3d4e5f';
const OTHER_APPLICATION_ID = '7a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d';
const MENTEE_USER_ID = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const TERM_ID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
const CALLER_USER_ID = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';

const application: MentorshipUpstreamApplication = {
  id: APPLICATION_ID,
  program_term_id: TERM_ID,
  user_id: MENTEE_USER_ID,
  role: 'mentee',
  status: 'accepted',
  tasks_submitted: false,
  admin_notified: false,
  created_on: '2026-06-01T10:00:00Z',
  updated_on: '2026-06-02T10:00:00Z',
};

describe('parseMentorshipMentorTaskCreateRequest', () => {
  const manyApplicationId = (index: number) => `5d1c8e2f-3a4b-4c6d-8e9f-${index.toString(16).padStart(12, '0')}`;

  const valid = { applicationIds: [APPLICATION_ID], name: 'Write a design doc', description: 'One page on the plan.' };

  it('trims the text and keeps the optional fields', () => {
    expect(
      parseMentorshipMentorTaskCreateRequest({
        applicationIds: [` ${APPLICATION_ID} `],
        name: '  Write a design doc  ',
        description: '  One page on the plan.  ',
        dueDate: '2026-11-30',
        requiresFileSubmission: true,
      })
    ).toEqual({
      applicationIds: [APPLICATION_ID],
      name: 'Write a design doc',
      description: 'One page on the plan.',
      dueDate: '2026-11-30',
      requiresFileSubmission: true,
    });
  });

  it('drops a repeated application id, whatever its case', () => {
    expect(
      parseMentorshipMentorTaskCreateRequest({ ...valid, applicationIds: [APPLICATION_ID, APPLICATION_ID.toUpperCase(), OTHER_APPLICATION_ID] })
    ).toMatchObject({
      applicationIds: [APPLICATION_ID, OTHER_APPLICATION_ID],
    });
  });

  it('takes the maximum number of applications, with repeats', () => {
    const ids = Array.from({ length: MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS }, (_, index) => manyApplicationId(index));

    expect(parseMentorshipMentorTaskCreateRequest({ ...valid, applicationIds: [...ids, ...ids] }).applicationIds).toEqual(ids);
  });

  it('refuses an oversized list without reading past the limit', () => {
    const ids = Array.from({ length: MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS + 1 }, (_, index) => manyApplicationId(index));

    // The trailing non-UUID would be refused with the UUID message if the parser read it.
    expect(() => parseMentorshipMentorTaskCreateRequest({ ...valid, applicationIds: [...ids, 'not-a-uuid'] })).toThrow(
      expect.objectContaining({
        validationErrors: [
          expect.objectContaining({ message: `applicationIds must hold at most ${MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS} applications` }),
        ],
      })
    );
  });

  it('leaves out a blank or null due date', () => {
    expect(parseMentorshipMentorTaskCreateRequest({ ...valid, dueDate: '' })).not.toHaveProperty('dueDate');
    expect(parseMentorshipMentorTaskCreateRequest({ ...valid, dueDate: null })).not.toHaveProperty('dueDate');
  });

  it('accepts text of exactly the maximum lengths', () => {
    const name = 'n'.repeat(MENTORSHIP_TASK_NAME_MAX);
    const description = 'd'.repeat(MENTORSHIP_TASK_DESCRIPTION_MAX);

    expect(parseMentorshipMentorTaskCreateRequest({ ...valid, name, description })).toMatchObject({ name, description });
  });

  it.each([
    ['a missing body', undefined],
    ['no application ids', { ...valid, applicationIds: [] }],
    ['application ids that are not a list', { ...valid, applicationIds: APPLICATION_ID }],
    ['an application id that is not a UUID', { ...valid, applicationIds: ['application-1'] }],
    [
      'more applications than the limit',
      {
        ...valid,
        applicationIds: Array.from({ length: MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS + 1 }, (_, index) => manyApplicationId(index)),
      },
    ],
    ['a blank name', { ...valid, name: '   ' }],
    ['a name that is not a string', { ...valid, name: 42 }],
    ['a name over the maximum length', { ...valid, name: 'n'.repeat(MENTORSHIP_TASK_NAME_MAX + 1) }],
    ['a missing description', { applicationIds: [APPLICATION_ID], name: 'Task' }],
    ['a description over the maximum length', { ...valid, description: 'd'.repeat(MENTORSHIP_TASK_DESCRIPTION_MAX + 1) }],
    ['a due date that is not YYYY-MM-DD', { ...valid, dueDate: '11/30/2026' }],
    ['a due date that is not on the calendar', { ...valid, dueDate: '2026-02-31' }],
    ['a file requirement that is not a boolean', { ...valid, requiresFileSubmission: 'yes' }],
  ])('rejects %s', (_label, body) => {
    expect(() => parseMentorshipMentorTaskCreateRequest(body)).toThrow(ServiceValidationError);
  });
});

describe('isMentorshipTaskAssignableApplication', () => {
  it('takes an accepted mentee application', () => {
    expect(isMentorshipTaskAssignableApplication(application)).toBe(true);
  });

  it.each([
    ['no application', undefined],
    ['a graduated mentee', { ...application, status: 'graduated' as const }],
    ['a pending mentee', { ...application, status: 'pending' as const }],
    ['a mentor application', { ...application, role: 'mentor' as const }],
    ['a user id that is not a UUID', { ...application, user_id: 'user-1' }],
    ['a term id that is not a UUID', { ...application, program_term_id: '' }],
  ])('refuses %s', (_label, candidate) => {
    expect(isMentorshipTaskAssignableApplication(candidate)).toBe(false);
  });
});

describe('buildMentorshipUpstreamTaskCreate', () => {
  it("assigns the application's mentee and term, owned and authored by the caller", () => {
    expect(
      buildMentorshipUpstreamTaskCreate(
        { applicationIds: [APPLICATION_ID], name: 'Task', description: 'Details', dueDate: '2026-11-30', requiresFileSubmission: true },
        application,
        CALLER_USER_ID
      )
    ).toEqual({
      assignee_id: MENTEE_USER_ID,
      program_term_id: TERM_ID,
      owner_id: CALLER_USER_ID,
      created_by: CALLER_USER_ID,
      name: 'Task',
      description: 'Details',
      category: 'non_prerequisite',
      custom: true,
      submit_file: 'required',
      due_date: '2026-11-30',
    });
  });

  it('leaves out the due date and file requirement when none is set', () => {
    const body = buildMentorshipUpstreamTaskCreate({ applicationIds: [APPLICATION_ID], name: 'Task', description: 'Details' }, application, CALLER_USER_ID);

    expect(body).not.toHaveProperty('due_date');
    expect(body).not.toHaveProperty('submit_file');
  });
});
