// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { MOCK_MENTORSHIP_MENTOR_PROGRAMS, MOCK_MENTORSHIP_PROGRAM_LISTS } from '@lfx-one/shared/constants';
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

    const source = MOCK_MENTORSHIP_MENTOR_PROGRAMS.find((program) => program.id === 'mp_gridflow_fall26')!;
    // Detail carries the raw program plus the derived tab counts and the mentee & applicant lists.
    expect(detail.program.id).toBe(source.id);
    expect(detail.program.slug).toBe(source.slug);
    expect(detail.program.name).toBe(source.name);

    // Tab counts derive from the raw admin mock list lengths (see
    // `buildMentorshipMentorProgramTabCounts` in `packages/shared`). `tasks` comes
    // from the program's own `stats.tasksToReview`.
    const adminLists = MOCK_MENTORSHIP_PROGRAM_LISTS[source.slug];
    expect(detail.tabCounts).toEqual({
      tasks: source.stats.tasksToReview,
      mentees: adminLists.mentees.length,
      applicants: adminLists.applicants.length,
    });
    // Lists spread onto the detail so the mentor page can render the same rows
    // without a second lookup.
    expect(detail.mentees).toEqual(adminLists.mentees);
    expect(detail.applicants).toEqual(adminLists.applicants);
  });

  it('resolves by slug for callers that route via the URL-friendly identifier', async () => {
    const source = MOCK_MENTORSHIP_MENTOR_PROGRAMS[0];
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

  it('falls back to the empty lists shape when a program has no admin mock entry', async () => {
    // A program that resolves against the mentor program list but has no entry in
    // `MOCK_MENTORSHIP_PROGRAM_LISTS` (which is keyed by slug). The runtime fallback
    // is `EMPTY_MENTORSHIP_PROGRAM_LISTS`, so `tabCounts.mentees` / `tabCounts.applicants`
    // must be zero (still gated on the fixture actually having such a program).
    const withoutLists = MOCK_MENTORSHIP_MENTOR_PROGRAMS.find((p) => !MOCK_MENTORSHIP_PROGRAM_LISTS[p.slug]);
    if (!withoutLists) return; // Every mentor program has admin lists today.
    const detail = await service.getMentorProgram(buildReq(), withoutLists.id);
    expect(detail.tabCounts.mentees).toBe(0);
    expect(detail.tabCounts.applicants).toBe(0);
  });
});
