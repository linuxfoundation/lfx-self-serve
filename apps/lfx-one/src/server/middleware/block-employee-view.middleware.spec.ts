// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveOrgLensViewMode: vi.fn() }));
vi.mock('../helpers/org-lens-read-access.helper', () => ({ resolveOrgLensViewMode: mocks.resolveOrgLensViewMode }));

const { blockEmployeeView } = await import('./block-employee-view.middleware');

const run = async (params: Record<string, string> = { orgUid: '0016100000ACMEAAA1' }) => {
  const next = vi.fn();
  await blockEmployeeView({ params, path: '/x' } as unknown as Request, {} as Response, next);
  return next;
};

beforeEach(() => vi.clearAllMocks());

describe('blockEmployeeView', () => {
  it('answers 403 EMPLOYEE_VIEW_FORBIDDEN, in company wording, in the employee view', async () => {
    mocks.resolveOrgLensViewMode.mockResolvedValue('employee');

    const next = await run();

    const error = next.mock.calls[0][0];
    expect(error).toMatchObject({ statusCode: 403, code: 'EMPLOYEE_VIEW_FORBIDDEN' });
    expect(error.message).toMatch(/company/);
    expect(error.message).not.toMatch(/organi[sz]ation/i);
  });

  it('lets the full view through', async () => {
    mocks.resolveOrgLensViewMode.mockResolvedValue('full');

    expect(await run()).toHaveBeenCalledWith();
  });

  it('passes the read gate refusal through unchanged', async () => {
    const refusal = Object.assign(new Error('nope'), { statusCode: 503 });
    mocks.resolveOrgLensViewMode.mockRejectedValue(refusal);

    expect((await run()).mock.calls[0][0]).toBe(refusal);
  });

  it('fails closed on a route with no company param', async () => {
    const next = await run({});

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 500, code: 'EMPLOYEE_VIEW_MISCONFIGURED' });
    expect(mocks.resolveOrgLensViewMode).not.toHaveBeenCalled();
  });
});
