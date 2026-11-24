// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveOrgLensViewMode: vi.fn() }));
vi.mock('../helpers/org-lens-read-access.helper', () => ({ resolveOrgLensViewMode: mocks.resolveOrgLensViewMode }));

const { blockEmployeeViewEcosystemCard } = await import('./block-employee-view-ecosystem-card.middleware');

const run = async (cardKey: string | undefined, orgUid: string | undefined = '0016100000ACMEAAA1') => {
  const next = vi.fn();
  const params: Record<string, string> = {};
  if (orgUid) params['orgUid'] = orgUid;
  if (cardKey) params['cardKey'] = cardKey;
  await blockEmployeeViewEcosystemCard({ params, path: '/x' } as unknown as Request, {} as Response, next);
  return next;
};

beforeEach(() => vi.clearAllMocks());

describe('blockEmployeeViewEcosystemCard', () => {
  it.each(['maintainers', 'contributors', 'commits', 'pull-requests', 'avg-merge-time'])(
    'lets the %s technical card through in the employee view',
    async (key) => {
      mocks.resolveOrgLensViewMode.mockResolvedValue('employee');
      expect(await run(key)).toHaveBeenCalledWith();
    }
  );

  it.each(['board-members', 'collaboration', 'meeting-attendance', 'certified-individuals', 'some-future-card', 'toString'])(
    'answers 403 for %s in the employee view (default deny)',
    async (key) => {
      mocks.resolveOrgLensViewMode.mockResolvedValue('employee');
      const next = await run(key);
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, code: 'EMPLOYEE_VIEW_FORBIDDEN' });
    }
  );

  it('answers 403 when the card key is missing in the employee view', async () => {
    mocks.resolveOrgLensViewMode.mockResolvedValue('employee');
    expect((await run(undefined)).mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });

  it('leaves the full view unchanged for every card', async () => {
    mocks.resolveOrgLensViewMode.mockResolvedValue('full');
    expect(await run('board-members')).toHaveBeenCalledWith();
    expect(await run('contributors')).toHaveBeenCalledWith();
  });

  it('passes the read gate refusal through unchanged', async () => {
    const refusal = Object.assign(new Error('nope'), { statusCode: 503 });
    mocks.resolveOrgLensViewMode.mockRejectedValue(refusal);
    expect((await run('contributors')).mock.calls[0][0]).toBe(refusal);
  });

  it('fails closed without a company param', async () => {
    expect((await run('contributors', '')).mock.calls[0][0]).toMatchObject({ statusCode: 500, code: 'EMPLOYEE_VIEW_MISCONFIGURED' });
  });
});
