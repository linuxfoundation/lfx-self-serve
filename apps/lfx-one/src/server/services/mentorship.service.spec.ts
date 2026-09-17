// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { getMockMentorshipMentorProgramLists, getMockMentorshipMentorPrograms } from '@lfx-one/shared/constants';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The service resolves its request-scoped logger through this module; stubbing it here
// avoids booting the real pino instance for a synchronous, in-memory lookup path.
vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

const { MentorshipService } = await import('./mentorship.service');
const { ResourceNotFoundError } = await import('../errors');

function buildReq(): Request {
  return { path: '/api/mentorship/mentor/programs/mp_gridflow_fall26' } as Request;
}

describe('MentorshipService.getMentorProgram', () => {
  let service: InstanceType<typeof MentorshipService>;

  beforeEach(() => {
    service = new MentorshipService();
  });

  it('resolves by primary id and returns a fully-built detail (program + tab counts + lists)', async () => {
    const detail = await service.getMentorProgram(buildReq(), 'mp_gridflow_fall26');

    const source = getMockMentorshipMentorPrograms().find((program) => program.id === 'mp_gridflow_fall26')!;
    // Detail carries the raw program plus the derived tab counts and the mentee & applicant lists.
    expect(detail.program.id).toBe(source.id);
    expect(detail.program.slug).toBe(source.slug);
    expect(detail.program.name).toBe(source.name);

    // Tab counts and rows come from the id-keyed mentor lists (term-filtered), not
    // the admin slug map. `tasks` is the submitted-task count on those mentees.
    const lists = getMockMentorshipMentorProgramLists()[source.id];
    expect(detail.tabCounts).toEqual({
      tasks: source.stats.tasksToReview,
      mentees: lists.mentees.length,
      applicants: lists.applicants.length,
    });
    expect(detail.program.stats.tasksToReview).toBe(detail.tabCounts.tasks);
    expect(detail.program.stats.mentees).toBe(lists.mentees.length);
    expect(detail.program.stats.applicants).toBe(lists.applicants.length);
    expect(detail.mentees).toEqual(lists.mentees);
    expect(detail.applicants).toEqual(lists.applicants);
    expect(detail.applicants.every((applicant) => applicant.termName === source.term)).toBe(true);
  });

  it('omits other-application links whose program id the mentor detail endpoint cannot resolve', async () => {
    const detail = await service.getMentorProgram(buildReq(), 'mp_gridflow_fall26');
    const ifeoma = detail.applicants.find((applicant) => applicant.id === 'app_ifeoma_adeyemi');
    expect(ifeoma?.otherApplications?.map((application) => application.programId)).toEqual(['mp_janusgraph_fall26']);
  });

  it('does not join a Fall mentor card to Winter applicant rows stored under the same slug', async () => {
    const detail = await service.getMentorProgram(buildReq(), 'mp_apicurio_fall26');
    const lists = getMockMentorshipMentorProgramLists()['mp_apicurio_fall26'];
    expect(detail.applicants).toEqual(lists.applicants);
    expect(detail.applicants.some((applicant) => applicant.termName === 'Winter 2026')).toBe(false);
    expect(detail.tabCounts.applicants).toBe(detail.applicants.length);
    expect(detail.program.stats.applicants).toBe(detail.applicants.length);
  });

  it('resolves by slug for callers that route via the URL-friendly identifier', async () => {
    const source = getMockMentorshipMentorPrograms()[0];
    const detail = await service.getMentorProgram(buildReq(), source.slug);
    expect(detail.program.id).toBe(source.id);
  });

  it('throws ResourceNotFoundError when neither id nor slug matches', async () => {
    await expect(service.getMentorProgram(buildReq(), 'mp_does_not_exist')).rejects.toBeInstanceOf(ResourceNotFoundError);
    // The error carries the operation tag so log/observability layers can group by it.
    await expect(service.getMentorProgram(buildReq(), 'mp_does_not_exist')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
      operation: 'mentorship_get_mentor_program',
    });
  });

  it('keeps header counts and rows aligned when a card has no people for its term', async () => {
    const detail = await service.getMentorProgram(buildReq(), 'mp_envoy_fall26');
    expect(detail.mentees).toEqual([]);
    expect(detail.applicants).toEqual([]);
    expect(detail.tabCounts.mentees).toBe(0);
    expect(detail.tabCounts.applicants).toBe(0);
    expect(detail.program.stats.mentees).toBe(0);
    expect(detail.program.stats.applicants).toBe(0);
  });

  it('lists only accepted and graduated mentees on the mentor Mentees tab payload', async () => {
    const detail = await service.getMentorProgram(buildReq(), 'mp_thanos_summer26');
    expect(detail.mentees.every((mentee) => mentee.status === 'accepted' || mentee.status === 'graduated')).toBe(true);
    expect(detail.mentees.map((mentee) => mentee.id)).toEqual(['mnt_thanos_1', 'mnt_thanos_2']);
    expect(detail.tabCounts.mentees).toBe(detail.mentees.length);
    expect(detail.program.stats.mentees).toBe(detail.mentees.length);
  });
});
