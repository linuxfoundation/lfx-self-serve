// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getOrgLensViewMode: vi.fn(), getFoundationsAndProjects: vi.fn() }));

vi.mock('../helpers/org-lens-read-access.helper', () => ({ getOrgLensViewMode: mocks.getOrgLensViewMode }));
vi.mock('../services/org-lens-foundations.service', () => ({
  OrgLensFoundationsService: class {
    public getFoundationsAndProjects = mocks.getFoundationsAndProjects;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: vi.fn(() => 0), success: vi.fn() } }));

const { OrgLensFoundationsController } = await import('./org-lens-foundations.controller');

const ORG_UID = '0014100000Te0pnAAB';

const RESPONSE = {
  accountId: ORG_UID,
  accountName: 'Acme',
  statStrip: { governanceRoles: { total: 2, boardMembers: 1, committeeMembers: 1 } },
  rows: [
    { foundationId: 'f1', foundationName: 'CNCF', contactEmail: 'ada@acme.example', projects: [{ projectName: 'K8s', fullName: 'Ada Lovelace', commits: 4 }] },
  ],
};

async function call(mode: 'full' | 'employee'): Promise<unknown> {
  mocks.getOrgLensViewMode.mockReturnValue(mode);
  mocks.getFoundationsAndProjects.mockResolvedValue(structuredClone(RESPONSE));
  const json = vi.fn();
  const res = { setHeader: vi.fn(), json } as unknown as Response;
  const req = { params: { orgUid: ORG_UID } } as unknown as Request;
  await new OrgLensFoundationsController().getFoundationsAndProjects(req, res, vi.fn());
  return json.mock.calls[0][0];
}

describe('OrgLensFoundationsController all employee view', () => {
  it('returns the response untouched in the full view', async () => {
    expect(await call('full')).toEqual(RESPONSE);
  });

  it('strips names and emails from the payload in the employee view and keeps the counts', async () => {
    const body = (await call('employee')) as typeof RESPONSE;

    expect(JSON.stringify(body)).not.toMatch(/ada@acme\.example|Ada Lovelace/);
    expect(body.statStrip.governanceRoles.total).toBe(2);
    expect(body.rows[0].projects[0]).toEqual({ projectName: 'K8s', commits: 4 });
  });
});
