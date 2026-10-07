// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_TASK_DESCRIPTION_MAX, MENTORSHIP_TASK_NAME_MAX } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { buildMentorshipUpstreamTaskUpdate, parseMentorshipAdminTaskUpdate } from './mentorship-admin-task.helper';

const OPERATION = 'update_mentorship_admin_task';

describe('parseMentorshipAdminTaskUpdate', () => {
  it('reads every field, trimming the text and the due date', () => {
    expect(
      parseMentorshipAdminTaskUpdate(
        { name: ' Read the guide ', description: ' Chapter one ', dueDate: ' 2030-01-31 ', requiresFileSubmission: true, status: 'in-progress' },
        OPERATION
      )
    ).toEqual({ name: 'Read the guide', description: 'Chapter one', dueDate: '2030-01-31', requiresFileSubmission: true, status: 'in-progress' });
  });

  it('reads a status alone, leaving the other fields out', () => {
    expect(parseMentorshipAdminTaskUpdate({ status: 'completed' }, OPERATION)).toEqual({ status: 'completed' });
  });

  it('keeps an empty due date, which clears it', () => {
    expect(parseMentorshipAdminTaskUpdate({ dueDate: '' }, OPERATION)).toEqual({ dueDate: '' });
  });

  it('accepts a name and a description of the largest length', () => {
    const name = 'n'.repeat(MENTORSHIP_TASK_NAME_MAX);
    const description = 'd'.repeat(MENTORSHIP_TASK_DESCRIPTION_MAX);

    expect(parseMentorshipAdminTaskUpdate({ name, description }, OPERATION)).toEqual({ name, description });
  });

  it.each([
    ['no body', undefined],
    ['a body that is not an object', 'status'],
    ['an empty body', {}],
    ['only fields the route does not take', { assigneeId: 'x' }],
    ['a blank name', { name: '   ' }],
    ['a name over the largest length', { name: 'n'.repeat(MENTORSHIP_TASK_NAME_MAX + 1) }],
    ['a name that is not a string', { name: 5 }],
    ['a blank description', { description: '' }],
    ['a description over the largest length', { description: 'd'.repeat(MENTORSHIP_TASK_DESCRIPTION_MAX + 1) }],
    ['a due date that is not a calendar date', { dueDate: '2030-02-31' }],
    ['a due date that is not a string', { dueDate: 20300131 }],
    ['a null due date', { dueDate: null }],
    ['a file requirement that is not a boolean', { requiresFileSubmission: 'yes' }],
    ['a status upstream spells', { status: 'in_progress' }],
    ['an unknown status', { status: 'done' }],
    ['a status that is not a string', { status: 1 }],
  ])('rejects %s with a 400', (_label, body) => {
    expect(() => parseMentorshipAdminTaskUpdate(body, OPERATION)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('buildMentorshipUpstreamTaskUpdate', () => {
  it('writes a full edit with the upstream status spelling and the file requirement as `required`', () => {
    expect(
      buildMentorshipUpstreamTaskUpdate({
        name: 'Read',
        description: 'Chapter one',
        dueDate: '2030-01-31',
        requiresFileSubmission: true,
        status: 'in-progress',
      })
    ).toEqual({ name: 'Read', description: 'Chapter one', due_date: '2030-01-31', submit_file: 'required', status: 'in_progress' });
  });

  it.each([
    ['pending', 'incomplete'],
    ['in-progress', 'in_progress'],
    ['submitted', 'submitted'],
    ['completed', 'complete'],
  ] as const)('maps the %s status to %s', (status, upstream) => {
    expect(buildMentorshipUpstreamTaskUpdate({ status })).toEqual({ status: upstream });
  });

  it('sends an empty submit_file to drop the file requirement and an empty due_date to clear the date', () => {
    expect(buildMentorshipUpstreamTaskUpdate({ requiresFileSubmission: false, dueDate: '' })).toEqual({ submit_file: '', due_date: '' });
  });

  it('leaves out a field the browser did not send, so upstream leaves it unchanged', () => {
    expect(buildMentorshipUpstreamTaskUpdate({ name: 'Read' })).toEqual({ name: 'Read' });
  });
});
