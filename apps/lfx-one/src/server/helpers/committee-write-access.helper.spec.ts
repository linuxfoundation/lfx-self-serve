// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkSingleAccessStrict, warning } = vi.hoisted(() => ({
  checkSingleAccessStrict: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('../services/access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccessStrict = checkSingleAccessStrict;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { warning },
}));

import { assertCommitteeWrite } from './committee-write-access.helper';

const req = {} as unknown as Request;

describe('assertCommitteeWrite', () => {
  beforeEach(() => {
    checkSingleAccessStrict.mockReset();
    warning.mockReset();
  });

  it('resolves without throwing when the caller has a writer grant', async () => {
    checkSingleAccessStrict.mockResolvedValueOnce(true);

    await expect(assertCommitteeWrite(req, 'committee-1', 'generate_weekly_brief')).resolves.toBeUndefined();
  });

  it('throws a 403 FORBIDDEN error when the caller has no grant', async () => {
    checkSingleAccessStrict.mockResolvedValueOnce(false);

    await expect(assertCommitteeWrite(req, 'committee-1', 'generate_weekly_brief')).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  it('throws a 503 ACCESS_CHECK_UNAVAILABLE error when the access-check call fails, and logs a warning', async () => {
    checkSingleAccessStrict.mockRejectedValueOnce(new Error('upstream down'));

    await expect(assertCommitteeWrite(req, 'committee-1', 'generate_weekly_brief')).rejects.toMatchObject({
      statusCode: 503,
      code: 'ACCESS_CHECK_UNAVAILABLE',
    });
    expect(warning).toHaveBeenCalledOnce();
  });

  it('checks the committee resource with the writer relation, not auditor (auditor is read-only per the FGA model)', async () => {
    checkSingleAccessStrict.mockResolvedValueOnce(true);

    await assertCommitteeWrite(req, 'committee-1', 'generate_weekly_brief');

    expect(checkSingleAccessStrict).toHaveBeenCalledWith(req, { resource: 'committee', id: 'committee-1', access: 'writer' });
  });
});
