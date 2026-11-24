// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getOrgLensViewMode: vi.fn(), getCardRoster: vi.fn(), getCardDrawer: vi.fn() }));

vi.mock('../helpers/org-lens-read-access.helper', () => ({ getOrgLensViewMode: mocks.getOrgLensViewMode }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/org-lens-project-detail.service', () => ({
  OrgLensProjectDetailService: class {
    public getCardRoster = mocks.getCardRoster;
    public getCardDrawer = mocks.getCardDrawer;
  },
}));
vi.mock('../helpers/org-commit-filters.helper', () => ({ parseOrgScope: () => 'all' }));

const { OrgLensProjectDetailController } = await import('./org-lens-project-detail.controller');

const ORG_UID = '0014100000Te2ovAAB';

const ROSTER = {
  total: 2,
  rows: [
    { cells: [{ person: { name: 'octocat', initials: 'OC' } }, { text: 'fix: thing\n\nSigned-off-by: Octo Cat <octo@acme.com>' }, { text: 'octo@acme.com' }] },
    { cells: [{ person: { name: 'Mona', initials: 'MO' } }, { text: 'feat: more' }, { text: '—' }] },
  ],
};

const call = async (method: 'getCardRoster' | 'getCardDrawer') => {
  const controller = new OrgLensProjectDetailController();
  const res = { setHeader: vi.fn(), json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
  const req = { params: { orgUid: ORG_UID, projectSlug: 'kubernetes', cardKey: 'commits' }, query: {} } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;
  await controller[method](req, res, next);
  return { res, next };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCardRoster.mockResolvedValue(structuredClone(ROSTER));
  mocks.getCardDrawer.mockResolvedValue({ key: 'commits', text: 'Contact a@b.co', rows: [] });
});

describe('OrgLensProjectDetailController all employee view', () => {
  it('keeps usernames and display names but removes every email address from a roster', async () => {
    mocks.getOrgLensViewMode.mockReturnValue('employee');

    const { res } = await call('getCardRoster');

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.rows[0].cells[0]).toEqual({ person: { name: 'octocat', initials: 'OC' } });
    expect(body.rows[1].cells[0]).toEqual({ person: { name: 'Mona', initials: 'MO' } });
    expect(JSON.stringify(body)).not.toMatch(/@/);
  });

  it('removes an email from a card drawer section', async () => {
    mocks.getOrgLensViewMode.mockReturnValue('employee');

    const { res } = await call('getCardDrawer');

    expect(JSON.stringify((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0])).not.toMatch(/@/);
  });

  it('leaves the full view untouched', async () => {
    mocks.getOrgLensViewMode.mockReturnValue('full');

    const { res } = await call('getCardRoster');

    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual(ROSTER);
  });
});
