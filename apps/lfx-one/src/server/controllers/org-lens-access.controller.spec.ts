// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceValidationError } from '../errors';

const { inviteUser } = vi.hoisted(() => ({ inviteUser: vi.fn() }));
vi.mock('../services/org-lens-access.service', () => ({
  OrgLensAccessService: class {
    public inviteUser = inviteUser;
  },
}));
const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/logger.service', () => ({ logger: loggerMock }));
vi.mock('../helpers/org-lens-edit-access.helper', () => ({ resolveOrgLensEdit: vi.fn() }));

import { SYNTHETIC_ORG_ACCOUNT_ID as ORG_UID } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { OrgLensAccessController } from './org-lens-access.controller';

async function invite(body: Record<string, unknown>): Promise<{ res: Response; next: NextFunction }> {
  const req = { params: { orgUid: ORG_UID }, body } as unknown as Request;
  const res = { setHeader: vi.fn(), json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  await new OrgLensAccessController().addUser(req, res, next);
  return { res, next };
}

describe('OrgLensAccessController.addUser — invite display name', () => {
  beforeEach(() => {
    inviteUser.mockReset();
    inviteUser.mockResolvedValue({ orgUid: ORG_UID, users: [] });
  });

  it.each([
    ['markup', '<img src="https://h.example/p.gif"><a href="https://h.example">x</a>'],
    ['a lone angle bracket', 'Ada > Grace'],
    ['a control character', 'Ada\u0007Lovelace'],
    ['a non-string value', ['<b>Ada</b>']],
  ])('rejects a name containing %s without calling upstream', async (_label, name) => {
    const { next } = await invite({ email: 'ada@acme-motors.example', role: 'viewer', name });

    expect(vi.mocked(next).mock.calls[0]?.[0]).toBeInstanceOf(ServiceValidationError);
    expect(inviteUser).not.toHaveBeenCalled();
  });

  it('forwards an ordinary name, stripping invisible BIDI formatting', async () => {
    const { res } = await invite({ email: 'ada@acme-motors.example', role: 'viewer', name: "  Ada O'Reilly\u202E " });

    expect(res.json).toHaveBeenCalled();
    expect(inviteUser).toHaveBeenCalledWith(expect.anything(), ORG_UID, 'ada@acme-motors.example', 'viewer', "Ada O'Reilly");
  });
});
