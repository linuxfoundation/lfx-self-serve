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

  it('returns an empty page, with a warning, for a caller with no mentorship record', async () => {
    stubUpstream(new MicroserviceError('Unauthorized', 401, 'UNAUTHORIZED', { errorBody: { error: 'local user is not provisioned' } }));

    expect(await service.getPrograms(buildReq(), paging)).toEqual({ data: [], total: 0 });
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_admin_get_programs', expect.any(String), {});
  });

  it('passes any other upstream error on', async () => {
    stubUpstream(new Error('upstream down'));

    await expect(service.getPrograms(buildReq(), paging)).rejects.toThrow('upstream down');
  });
});

describe('MentorshipAdminService.getProgram', () => {
  it('resolves a mock program and throws 404 for an unknown one', async () => {
    const service = new MentorshipAdminService();

    await expect(service.getProgram(buildReq(), 'no-such-program')).rejects.toMatchObject({ statusCode: 404 });
  });
});
