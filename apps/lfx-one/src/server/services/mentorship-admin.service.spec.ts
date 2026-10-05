// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../utils/auth-helper', () => ({
  isImpersonating: vi.fn(() => false),
}));

const { MentorshipAdminService } = await import('./mentorship-admin.service');
const { MicroserviceProxyService } = await import('./microservice-proxy.service');
const { MicroserviceError } = await import('../errors');
const { logger } = await import('./logger.service');

const buildReq = (): Request => ({ path: '/api/mentorship/admin/programs' }) as Request;

const upstreamProgram = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  slug: id,
  name,
  status: 'published',
  admin_status: 'open',
  project_name: 'Energy Project',
  term: { id: 't', name: 'Spring', status: 'open' },
  stats: { mentors: 1, mentees: 2, graduated: 0 },
  created_on: '2026-01-01',
  updated_on: '2026-01-02',
  ...overrides,
});

const stubUpstream = (response: { rows?: unknown[]; total?: number } | Error) =>
  vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockImplementation(async (_req, _service, path: string) => {
    if (path === '/mentorship/v1/me') return {} as never;
    if (path === '/mentorship/v1/me/programs') {
      if (response instanceof Error) throw response;
      const rows = response.rows ?? [];
      return { data: rows, meta: { total: response.total ?? rows.length, limit: 12, offset: 0 } } as never;
    }
    throw new Error(`unexpected path ${path}`);
  });

describe('MentorshipAdminService.getPrograms', () => {
  let service: InstanceType<typeof MentorshipAdminService>;
  const paging = { offset: 0, limit: 12 };

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the programs upstream returns, mapped for the card, with upstream’s total', async () => {
    stubUpstream({
      rows: [upstreamProgram('p-a', 'Alpha'), upstreamProgram('p-b', 'Beta', { admin_status: 'completed', term: undefined })],
      total: 30,
    });

    const result = await service.getPrograms(buildReq(), paging);

    expect(result.total).toBe(30);
    expect(result.data.map((p) => [p.id, p.status, p.term])).toEqual([
      ['p-a', 'open', 'Spring'],
      ['p-b', 'completed', ''],
    ]);
  });

  it('makes one upstream call that carries the search, status, limit and offset', async () => {
    const spy = stubUpstream({ rows: [] });

    await service.getPrograms(buildReq(), { search: '  50%_off  ', status: 'pending-review', offset: 24, limit: 12 });

    const calls = spy.mock.calls.filter(([, , path]) => path !== '/mentorship/v1/me');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      expect.anything(),
      'LFX_V2_SERVICE',
      '/mentorship/v1/me/programs',
      'GET',
      { search: String.raw`50\%\_off`, status: 'pending_review', limit: 12, offset: 24 },
      undefined,
    ]);
  });

  it('sends no search or status when none is given', async () => {
    const spy = stubUpstream({ rows: [] });

    await service.getPrograms(buildReq(), paging);

    expect(spy.mock.calls[0][4]).toEqual({ search: undefined, status: undefined, limit: 12, offset: 0 });
  });

  it('shows an unrecognised admin status as pending review and logs the id and status only', async () => {
    stubUpstream({ rows: [upstreamProgram('p-a', 'Alpha', { admin_status: 'mystery' })] });

    const { data } = await service.getPrograms(buildReq(), paging);

    expect(data[0].status).toBe('pending-review');
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_admin_get_programs', expect.any(String), {
      programId: 'p-a',
      adminStatus: 'mystery',
    });
  });

  it('provisions a first-time caller and retries, then returns an empty page, with a warning, if still not provisioned', async () => {
    const spy = stubUpstream(new MicroserviceError('Unauthorized', 401, 'UNAUTHORIZED', { errorBody: { error: 'local user is not provisioned' } }));

    expect(await service.getPrograms(buildReq(), paging)).toEqual({ data: [], total: 0 });
    expect(spy.mock.calls.map(([, , path, method]) => `${method} ${path}`)).toEqual([
      'GET /mentorship/v1/me/programs',
      'PUT /mentorship/v1/me',
      'GET /mentorship/v1/me/programs',
    ]);
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_admin_get_programs', expect.any(String), {});
  });

  it('passes any other upstream error on', async () => {
    stubUpstream(new Error('upstream down'));

    await expect(service.getPrograms(buildReq(), paging)).rejects.toThrow('upstream down');
  });
});

const PROGRAM_ID = '3f2b8c1e-7a44-4d0e-9b55-0c1d2e3f4a5b';
const APPLICATION_ID = '9a1c2d3e-4b5f-4a6b-8c7d-1e2f3a4b5c6d';
const PROGRAM_PATH = `/mentorship/v1/programs/${PROGRAM_ID}`;

const header = {
  program: { id: PROGRAM_ID, slug: 'grid', name: 'Grid', status: 'published', created_on: '2026-01-01', updated_on: '2026-01-02' },
  active_term: { id: 't1', name: 'Fall', status: 'open' },
  stats: { mentors: 1, mentees: 2, graduated: 0 },
};
const summary = { has_open_term: true, has_closed_term: false, mentees: 2, past_mentees: 4, applicants: 5, mentors: 1, terms: 3 };
const applicationRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  user_id: `u-${id}`,
  application_id: id,
  status: 'hold',
  name: 'Ada Mentee',
  email: 'ada@mentee.example',
  tasks_submitted: 1,
  tasks_total: 2,
  term: { id: 't1', name: 'Fall', status: 'open' },
  created_on: '2026-08-01T00:00:00Z',
  updated_on: '2026-08-02T00:00:00Z',
  ...overrides,
});

/** Answers each read from `routes`; a route set to an Error rejects, and one left out is a test bug. */
const stubProgramReads = (routes: Record<string, unknown>) =>
  vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockImplementation(async (_req, _service, path: string) => {
    const route = routes[path];
    if (route === undefined) throw new Error(`unexpected path ${path}`);
    if (route instanceof Error) throw route;
    return route as never;
  });

const pageRoutes = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  [`${PROGRAM_PATH}/header`]: header,
  [`${PROGRAM_PATH}/management-summary`]: summary,
  [`${PROGRAM_PATH}/applications`]: { data: [], meta: { total: 7, limit: 1, offset: 0 } },
  [`${PROGRAM_PATH}/member-management`]: { data: [], meta: { total: 2, limit: 1, offset: 0 } },
  [`${PROGRAM_PATH}/terms`]: {
    data: [
      { id: 't1', name: 'Fall', status: 'open' },
      { id: 't0', name: 'Spring', status: 'closed' },
      { id: 'tx', name: 'Gone', status: 'deleted' },
    ],
    meta: { total: 3, limit: 100, offset: 0 },
  },
  ...overrides,
});

describe('MentorshipAdminService.getProgramPage', () => {
  let service: InstanceType<typeof MentorshipAdminService>;

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the header, the four counts and the open and closed terms', async () => {
    stubProgramReads(pageRoutes());

    const page = await service.getProgramPage(buildReq(), PROGRAM_ID);

    expect(page.program).toMatchObject({ id: PROGRAM_ID, name: 'Grid', term: 'Fall', status: 'open' });
    expect(page.tabCounts).toEqual({ currentMentees: 7, pastMentees: 4, mentors: 2, terms: 3 });
    expect(page.terms).toEqual([
      { id: 't1', name: 'Fall', status: 'open' },
      { id: 't0', name: 'Spring', status: 'closed' },
    ]);
  });

  it('sends the one-row count reads and the largest terms page', async () => {
    const spy = stubProgramReads(pageRoutes());

    await service.getProgramPage(buildReq(), PROGRAM_ID);

    const queries = Object.fromEntries(spy.mock.calls.map(([, , path, , query]) => [path, query]));
    expect(queries[`${PROGRAM_PATH}/applications`]).toEqual({ type: 'current', limit: 1 });
    expect(queries[`${PROGRAM_PATH}/member-management`]).toEqual({ limit: 1 });
    expect(queries[`${PROGRAM_PATH}/terms`]).toEqual({ limit: 100, offset: 0 });
  });

  it('reads every page of the terms at 100 a page', async () => {
    const term = (n: number) => ({ id: `t${n}`, name: `Term ${n}`, status: 'closed' });
    const routes = pageRoutes();
    const spy = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockImplementation(async (_req, _service, path: string, _method, query) => {
      if (path === `${PROGRAM_PATH}/terms`) {
        const offset = (query as { offset: number }).offset;
        const count = offset === 0 ? 100 : 5;
        return { data: Array.from({ length: count }, (_, i) => term(offset + i)), meta: { total: 105, limit: 100, offset } } as never;
      }
      return routes[path] as never;
    });

    const page = await service.getProgramPage(buildReq(), PROGRAM_ID);

    expect(page.terms).toHaveLength(105);
    const termQueries = spy.mock.calls.filter(([, , path]) => path === `${PROGRAM_PATH}/terms`).map(([, , , , query]) => query);
    expect(termQueries).toEqual([
      { limit: 100, offset: 0 },
      { limit: 100, offset: 100 },
    ]);
  });

  it('reads a published program with only closed terms as completed', async () => {
    stubProgramReads(pageRoutes({ [`${PROGRAM_PATH}/management-summary`]: { ...summary, has_open_term: false, has_closed_term: true } }));

    expect((await service.getProgramPage(buildReq(), PROGRAM_ID)).program.status).toBe('completed');
  });

  it('shows a count as null when its read fails, and the terms as empty', async () => {
    stubProgramReads(
      pageRoutes({
        [`${PROGRAM_PATH}/management-summary`]: new Error('down'),
        [`${PROGRAM_PATH}/applications`]: new Error('down'),
        [`${PROGRAM_PATH}/member-management`]: new Error('down'),
        [`${PROGRAM_PATH}/terms`]: new Error('down'),
      })
    );

    const page = await service.getProgramPage(buildReq(), PROGRAM_ID);

    expect(page.tabCounts).toEqual({ currentMentees: null, pastMentees: null, mentors: null, terms: null });
    expect(page.terms).toEqual([]);
    expect(page.program.status).toBe('open');
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_admin_get_program', expect.any(String), { programId: PROGRAM_ID, failed: 4 });
  });

  it.each([404, 403])('passes a header %i on', async (statusCode) => {
    stubProgramReads(pageRoutes({ [`${PROGRAM_PATH}/header`]: new MicroserviceError('nope', statusCode, 'UPSTREAM') }));

    await expect(service.getProgramPage(buildReq(), PROGRAM_ID)).rejects.toMatchObject({ statusCode });
  });

  it.each(['management-summary', 'applications', 'member-management'])(
    'passes a 403 on the manager-only %s read on, since any viewer may read the header',
    async (route) => {
      stubProgramReads(pageRoutes({ [`${PROGRAM_PATH}/${route}`]: new MicroserviceError('Forbidden', 403, 'FORBIDDEN') }));

      await expect(service.getProgramPage(buildReq(), PROGRAM_ID)).rejects.toMatchObject({ statusCode: 403 });
    }
  );

  it('keeps the page when a manager-only read fails with anything but a 403', async () => {
    stubProgramReads(pageRoutes({ [`${PROGRAM_PATH}/management-summary`]: new MicroserviceError('Bad gateway', 502, 'UPSTREAM') }));

    const page = await service.getProgramPage(buildReq(), PROGRAM_ID);

    expect(page.tabCounts).toMatchObject({ pastMentees: null, terms: null, currentMentees: 7 });
  });

  it('shows an unrecognised program status as pending review and logs the id and status only', async () => {
    stubProgramReads(pageRoutes({ [`${PROGRAM_PATH}/header`]: { ...header, program: { ...header.program, status: 'mystery' } } }));

    const page = await service.getProgramPage(buildReq(), PROGRAM_ID);

    expect(page.program.status).toBe('pending-review');
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_admin_get_program', expect.any(String), {
      programId: PROGRAM_ID,
      status: 'mystery',
    });
  });
});

describe('MentorshipAdminService.getProgramMentees', () => {
  let service: InstanceType<typeof MentorshipAdminService>;

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('makes exactly one applications read with the query as described, and maps the rows', async () => {
    const spy = stubProgramReads({
      [`${PROGRAM_PATH}/applications`]: { data: [applicationRow('a1')], meta: { total: 37, limit: 10, offset: 10 } },
    });

    const result = await service.getProgramMentees(buildReq(), PROGRAM_ID, {
      type: 'current',
      status: 'pending',
      termId: 't1',
      search: '  50%_off ',
      offset: 10,
      limit: 10,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0].slice(1)).toEqual([
      'LFX_V2_SERVICE',
      `${PROGRAM_PATH}/applications`,
      'GET',
      { type: 'current', status: 'pending', term: 't1', search: String.raw`50\%\_off`, offset: 10, limit: 10 },
      undefined,
    ]);
    expect(result.total).toBe(37);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 'a1', status: 'pending', termId: 't1', termName: 'Fall' });
    expect(result.data[0].tasks).toBeUndefined();
  });

  it('defaults to offset 0 and 10 rows, and never sends more than 50', async () => {
    const spy = stubProgramReads({ [`${PROGRAM_PATH}/applications`]: { data: [], meta: { total: 0, limit: 10, offset: 0 } } });

    await service.getProgramMentees(buildReq(), PROGRAM_ID, { type: 'past' });
    await service.getProgramMentees(buildReq(), PROGRAM_ID, { type: 'past', limit: 500 });

    expect(spy.mock.calls[0][4]).toMatchObject({ type: 'past', offset: 0, limit: 10, search: undefined, status: undefined, term: undefined });
    expect(spy.mock.calls[1][4]).toMatchObject({ limit: 50 });
  });

  it('returns an empty page when the caller has no mentorship record', async () => {
    stubProgramReads({
      '/mentorship/v1/me': {},
      [`${PROGRAM_PATH}/applications`]: new MicroserviceError('Unauthorized', 401, 'UNAUTHORIZED', { errorBody: { error: 'local user is not provisioned' } }),
    });

    expect(await service.getProgramMentees(buildReq(), PROGRAM_ID, { type: 'current' })).toEqual({ data: [], total: 0 });
  });

  it('passes any other upstream error on', async () => {
    stubProgramReads({ [`${PROGRAM_PATH}/applications`]: new MicroserviceError('boom', 500, 'UPSTREAM') });

    await expect(service.getProgramMentees(buildReq(), PROGRAM_ID, { type: 'current' })).rejects.toMatchObject({ statusCode: 500 });
  });
});

describe('MentorshipAdminService.getApplicationTasks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads every page of the tasks at 100 a page and maps them', async () => {
    const path = `/mentorship/v1/applications/${APPLICATION_ID}/tasks`;
    const task = (id: string, status: string) => ({
      id,
      application_id: APPLICATION_ID,
      assignee_id: 'mentee',
      status,
      name: id,
      custom: false,
      created_on: '2026-08-01T00:00:00Z',
      updated_on: '2026-08-01T00:00:00Z',
    });
    const spy = vi
      .spyOn(MicroserviceProxyService.prototype, 'proxyRequest')
      .mockResolvedValueOnce({ data: [task('t1', 'incomplete')], meta: { total: 2, limit: 100, offset: 0 } } as never)
      .mockResolvedValueOnce({ data: [task('t2', 'complete')], meta: { total: 2, limit: 100, offset: 1 } } as never);

    const tasks = await new MentorshipAdminService().getApplicationTasks(buildReq(), APPLICATION_ID);

    expect(tasks.map((t) => [t.id, t.status])).toEqual([
      ['t1', 'pending'],
      ['t2', 'completed'],
    ]);
    expect(spy.mock.calls.map(([, , calledPath, , query]) => [calledPath, query])).toEqual([
      [path, { limit: 100, offset: 0 }],
      [path, { limit: 100, offset: 1 }],
    ]);
  });
});

const memberRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  user_id: `u-${id}`,
  name: 'Ada Mentor',
  email: 'ada@mentor.example',
  status: 'active',
  created_on: '2026-02-03T10:00:00Z',
  updated_on: '2026-02-04T10:00:00Z',
  profile_created: true,
  ...overrides,
});

const termManagementRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  program_id: PROGRAM_ID,
  name: 'Fall',
  status: 'open',
  active_users: 1,
  created_on: '2026-01-01T00:00:00Z',
  updated_on: '2026-01-02T00:00:00Z',
  pending: 1,
  declined: 0,
  accepted: 2,
  graduated: 0,
  ...overrides,
});

describe('MentorshipAdminService.getProgramMentors', () => {
  let service: InstanceType<typeof MentorshipAdminService>;
  const MEMBERS_PATH = `${PROGRAM_PATH}/member-management`;

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps the mentor rows and returns upstream’s total', async () => {
    stubProgramReads({
      [MEMBERS_PATH]: { data: [memberRow('m1'), memberRow('m2', { status: 'invited' })], meta: { total: 12, limit: 10, offset: 0 } },
    });

    const result = await service.getProgramMentors(buildReq(), PROGRAM_ID, { offset: 0, limit: 10 });

    expect(result.total).toBe(12);
    expect(result.data.map((m) => [m.id, m.status])).toEqual([
      ['m1', 'active'],
      ['m2', 'invited'],
    ]);
  });

  it('makes one upstream call with the status, escaped search, offset and a capped limit, and no member_type', async () => {
    const spy = stubProgramReads({ [MEMBERS_PATH]: { data: [], meta: { total: 0 } } });

    await service.getProgramMentors(buildReq(), PROGRAM_ID, { status: 'active', search: '  50%_off ', offset: 20, limit: 500 });

    expect(spy.mock.calls).toHaveLength(1);
    expect(spy.mock.calls[0][4]).toEqual({ status: 'active', search: String.raw`50\%\_off`, offset: 20, limit: 50 });
  });

  it('defaults to offset 0 and limit 10', async () => {
    const spy = stubProgramReads({ [MEMBERS_PATH]: { data: [] } });

    await service.getProgramMentors(buildReq(), PROGRAM_ID, {});

    expect(spy.mock.calls[0][4]).toMatchObject({ offset: 0, limit: 10 });
  });

  it('shows an unknown status as pending and logs the ids and status, never the name', async () => {
    stubProgramReads({ [MEMBERS_PATH]: { data: [memberRow('m1', { status: 'mystery' })] } });

    const { data } = await service.getProgramMentors(buildReq(), PROGRAM_ID, {});

    expect(data[0].status).toBe('pending');
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_admin_get_program_mentors', expect.any(String), {
      programId: PROGRAM_ID,
      memberId: 'm1',
      status: 'mystery',
    });
    expect(JSON.stringify(vi.mocked(logger.warning).mock.calls)).not.toContain('Ada Mentor');
  });

  it('returns an empty page, with a warning, for a caller with no mentorship record', async () => {
    stubProgramReads({
      [MEMBERS_PATH]: new MicroserviceError('Unauthorized', 401, 'UNAUTHORIZED', { errorBody: { error: 'local user is not provisioned' } }),
      '/mentorship/v1/me': {},
    });

    expect(await service.getProgramMentors(buildReq(), PROGRAM_ID, {})).toEqual({ data: [], total: 0 });
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_admin_get_program_mentors', expect.any(String), { programId: PROGRAM_ID });
  });

  it('passes any other upstream error on', async () => {
    stubProgramReads({ [MEMBERS_PATH]: new MicroserviceError('Forbidden', 403, 'FORBIDDEN') });

    await expect(service.getProgramMentors(buildReq(), PROGRAM_ID, {})).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('MentorshipAdminService.getProgramTerms', () => {
  let service: InstanceType<typeof MentorshipAdminService>;
  const TERMS_PATH = `${PROGRAM_PATH}/term-management`;

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps the term rows with their counts, drops a term that is not open or closed, and returns upstream’s total', async () => {
    stubProgramReads({
      [TERMS_PATH]: {
        data: [termManagementRow('t1'), termManagementRow('t2', { status: 'closed' }), termManagementRow('t3', { status: 'deleted' })],
        meta: { total: 3, limit: 10, offset: 0 },
      },
    });

    const result = await service.getProgramTerms(buildReq(), PROGRAM_ID, { offset: 0, limit: 10 });

    expect(result.total).toBe(3);
    expect(result.data.map((t) => [t.id, t.status, t.pending, t.accepted])).toEqual([
      ['t1', 'open', 1, 2],
      ['t2', 'closed', 1, 2],
    ]);
  });

  it('makes one upstream call with the offset and a capped limit', async () => {
    const spy = stubProgramReads({ [TERMS_PATH]: { data: [] } });

    await service.getProgramTerms(buildReq(), PROGRAM_ID, { offset: 10, limit: 500 });

    expect(spy.mock.calls).toHaveLength(1);
    expect(spy.mock.calls[0][4]).toEqual({ offset: 10, limit: 50 });
  });

  it('returns an empty page for a caller with no mentorship record', async () => {
    stubProgramReads({
      [TERMS_PATH]: new MicroserviceError('Unauthorized', 401, 'UNAUTHORIZED', { errorBody: { error: 'local user is not provisioned' } }),
      '/mentorship/v1/me': {},
    });

    expect(await service.getProgramTerms(buildReq(), PROGRAM_ID, {})).toEqual({ data: [], total: 0 });
  });

  it('passes any other upstream error on', async () => {
    stubProgramReads({ [TERMS_PATH]: new Error('upstream down') });

    await expect(service.getProgramTerms(buildReq(), PROGRAM_ID, {})).rejects.toThrow('upstream down');
  });
});

describe('MentorshipAdminService application decisions', () => {
  const APPLICATION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  const TERM_ID = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
  const APPLICATION_PATH = `/mentorship/v1/applications/${APPLICATION_ID}`;
  let service: InstanceType<typeof MentorshipAdminService>;

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('patches the status, sending the attendance type only with an accept', async () => {
    const spy = stubProgramReads({ [`${APPLICATION_PATH}/status`]: {} });

    await service.updateApplicationStatus(buildReq(), APPLICATION_ID, { status: 'accepted', attendanceType: 'part_time' });
    await service.updateApplicationStatus(buildReq(), APPLICATION_ID, { status: 'declined', attendanceType: 'full_time' });

    expect(spy.mock.calls.map((call) => [call[3], call[5]])).toEqual([
      ['PATCH', { status: 'accepted', attendance_type: 'part_time' }],
      ['PATCH', { status: 'declined' }],
    ]);
  });

  it('passes an upstream 422 on', async () => {
    stubProgramReads({ [`${APPLICATION_PATH}/status`]: new MicroserviceError('closed', 422, 'UNPROCESSABLE') });

    await expect(service.updateApplicationStatus(buildReq(), APPLICATION_ID, { status: 'graduated' })).rejects.toMatchObject({ statusCode: 422 });
  });

  it.each(['pending', 'accepted'])('withdraws a %s application on the mentee behalf', async (status) => {
    const spy = stubProgramReads({ [APPLICATION_PATH]: { id: APPLICATION_ID, status }, [`${APPLICATION_PATH}/withdraw-for-mentee`]: {} });

    await service.withdrawApplication(buildReq(), APPLICATION_ID);

    expect(spy.mock.calls.map((call) => [call[3], call[2]])).toEqual([
      ['GET', APPLICATION_PATH],
      ['POST', `${APPLICATION_PATH}/withdraw-for-mentee`],
    ]);
  });

  it.each(['declined', 'hold', 'withdrawn', 'graduated'])('answers 409 without writing when the application is %s', async (status) => {
    const spy = stubProgramReads({ [APPLICATION_PATH]: { id: APPLICATION_ID, status } });

    await expect(service.withdrawApplication(buildReq(), APPLICATION_ID)).rejects.toMatchObject({
      statusCode: 409,
      message: 'This application changed. The list has been refreshed.',
    });
    expect(spy.mock.calls.every((call) => call[3] === 'GET')).toBe(true);
  });

  it('declines the term pending applications and maps the count', async () => {
    const spy = stubProgramReads({
      [`/mentorship/v1/programs/${PROGRAM_ID}/terms/${TERM_ID}/applications/bulk-decline`]: { declined_count: 4 },
    });

    expect(await service.declinePendingForTerm(buildReq(), PROGRAM_ID, TERM_ID)).toEqual({ declinedCount: 4 });
    expect(spy.mock.calls[0][3]).toBe('POST');
  });
});
