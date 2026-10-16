// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSummary, getPage, getExportRows, getOrgLensReadableAccountIds } = vi.hoisted(() => ({
  getSummary: vi.fn(),
  getPage: vi.fn(),
  getExportRows: vi.fn(),
  getOrgLensReadableAccountIds: vi.fn(),
}));

vi.mock('../services/project-participating-orgs.service', () => ({
  ProjectParticipatingOrgsService: class {
    public getSummary = getSummary;
    public getPage = getPage;
    public getExportRows = getExportRows;
    public getOrgLensReadableAccountIds = getOrgLensReadableAccountIds;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// The `@lfx-one/shared/utils` barrel cannot load in this server-only runtime; a minimal CSV joiner stands in.
vi.mock('@lfx-one/shared/utils', () => ({
  rowsToCsv: (rows: (string | number)[][]) => rows.map((r) => r.join(',')).join('\r\n'),
}));

import {
  PROJECT_PARTICIPATING_ORGS_EXPORT_CSV_HEADER,
  PROJECT_PARTICIPATING_ORGS_MAX_PAGE_SIZE,
  PROJECT_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH,
  PROJECT_PARTICIPATING_ORGS_PAGE_SIZE,
} from '@lfx-one/shared/constants';

import { ServiceValidationError } from '../errors';
import { ProjectParticipatingOrgsController } from './project-participating-orgs.controller';

import type { ProjectParticipatingOrg } from '@lfx-one/shared/interfaces';

type Handler = 'getSummary' | 'getList' | 'getOrgLensLinks' | 'export';

function buildRes() {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    json: vi.fn(),
    send: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    status: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

async function call(handler: Handler, query: Record<string, unknown>) {
  const res = buildRes();
  const next = vi.fn();
  const req = { params: { slug: 'synthetic-project' }, query } as unknown as Request;
  await new ProjectParticipatingOrgsController()[handler](req, res as unknown as Response, next as unknown as NextFunction);
  return { res, next };
}

const member: ProjectParticipatingOrg = {
  participantKey: '001SYNTHMEMBERAAAA',
  accountId: '001SYNTHMEMBERAAAA',
  name: 'Synthetic, Member',
  logoUrl: null,
  isUnidentified: false,
  isMember: true,
  membershipTierClass: 'Gold',
  commits: 10,
  commitsPrev: 4,
  commitsChange: 1.5,
  contributors: 3,
  contributorsPrev: null,
  contributorsChange: null,
};

describe('ProjectParticipatingOrgsController validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSummary.mockResolvedValue(null);
    getPage.mockResolvedValue({ rows: [], totalRecords: 0, foundationSlug: null });
    getExportRows.mockResolvedValue({ rows: [], truncated: false });
  });

  it.each([
    ['getSummary', { range: '7d' }, 'range'],
    ['getList', { range: 'YTD' }, 'range'],
    ['getList', { segment: 'everyone' }, 'segment'],
    ['getList', { sort: 'revenue' }, 'sort'],
    ['getList', { dir: 'up' }, 'dir'],
    ['getList', { tier: 'Diamond' }, 'tier'],
    ['getList', { search: 'a'.repeat(PROJECT_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH + 1) }, 'search'],
    ['getList', { segment: ['all', 'members'] }, 'segment'],
    ['export', { sort: 'revenue' }, 'sort'],
  ] as const)('%s rejects %o with a 400 on the field', async (handler, query, field) => {
    const { next } = await call(handler, query);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.validationErrors[0].field).toBe(field);
    expect(error.statusCode).toBe(400);
    expect(getPage).not.toHaveBeenCalled();
    expect(getSummary).not.toHaveBeenCalled();
    expect(getExportRows).not.toHaveBeenCalled();
  });

  it('applies list defaults and passes validated filters', async () => {
    await call('getList', {});
    expect(getPage).toHaveBeenCalledWith(expect.anything(), 'synthetic-project', {
      range: '12mo',
      segment: 'all',
      sort: 'commits',
      dir: 'desc',
      pageSize: PROJECT_PARTICIPATING_ORGS_PAGE_SIZE,
      offset: 0,
    });

    await call('getList', { range: '30d', segment: 'members', tier: 'Gold', search: '  syn  ', sort: 'tier', dir: 'asc', pageSize: '50', offset: '50' });
    expect(getPage).toHaveBeenLastCalledWith(expect.anything(), 'synthetic-project', {
      range: '30d',
      segment: 'members',
      tier: 'Gold',
      search: 'syn',
      sort: 'tier',
      dir: 'asc',
      pageSize: 50,
      offset: 50,
    });
  });
});

describe('ProjectParticipatingOrgsController.getOrgLensLinks', () => {
  const A = '001SYNTHMEMBERAAAA';
  const B = '001SYNTHMEMBERBBBB';

  beforeEach(() => {
    vi.clearAllMocks();
    getOrgLensReadableAccountIds.mockResolvedValue([A]);
  });

  it.each([
    ['missing', {}],
    ['empty', { accountIds: '' }],
    ['non-canonical (15-char)', { accountIds: '001SYNTHMEMBERAA' }],
    ['repeated param', { accountIds: [A, B] }],
    [
      'over one max page',
      { accountIds: Array.from({ length: PROJECT_PARTICIPATING_ORGS_MAX_PAGE_SIZE + 1 }, (_, i) => `001SYNTH${String(i).padStart(10, '0')}`).join(',') },
    ],
  ] as const)('rejects %s account ids with a 400', async (_label, query) => {
    const { next } = await call('getOrgLensLinks', query);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.validationErrors[0].field).toBe('accountIds');
    expect(getOrgLensReadableAccountIds).not.toHaveBeenCalled();
  });

  it('dedupes the ids and answers the readable subset, uncacheable', async () => {
    const { res } = await call('getOrgLensLinks', { accountIds: ` ${A},${B},${A}` });

    expect(getOrgLensReadableAccountIds).toHaveBeenCalledWith(expect.anything(), [A, B]);
    expect(res.json).toHaveBeenCalledWith({ readableAccountIds: [A] });
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });
});

describe('ProjectParticipatingOrgsController.export', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends a CSV attachment with no-store, nosniff, BOM and the export columns', async () => {
    getExportRows.mockResolvedValue({ rows: [member], truncated: false });

    const { res, next } = await call('export', { range: '90d' });

    expect(next).not.toHaveBeenCalled();
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(res.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Content-Disposition']).toMatch(/participating-orgs-synthetic-project-90d-\d{4}-\d{2}-\d{2}\.csv/);
    expect(res.headers['X-Export-Truncated']).toBeUndefined();
    const body = res.send.mock.calls[0][0] as string;
    expect(body.startsWith(`\ufeff${PROJECT_PARTICIPATING_ORGS_EXPORT_CSV_HEADER.join(',')}`)).toBe(true);
    expect(body).toContain('Synthetic, Member,Member,Gold,No,10,4,3,');
  });

  it('flags a capped export', async () => {
    getExportRows.mockResolvedValue({ rows: [member], truncated: true });
    const { res } = await call('export', {});
    expect(res.headers['X-Export-Truncated']).toBe('true');
  });

  it('answers 204 when nothing matches', async () => {
    getExportRows.mockResolvedValue({ rows: [], truncated: false });
    const { res } = await call('export', {});
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).not.toHaveBeenCalled();
  });
});
