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

import { assertCommitteeAccess } from './committee-access.internal.helper';

const req = {} as unknown as Request;

describe('assertCommitteeAccess', () => {
  beforeEach(() => {
    checkSingleAccessStrict.mockReset();
    warning.mockReset();
  });

  it('resolves without throwing when the caller has the requested grant', async () => {
    checkSingleAccessStrict.mockResolvedValueOnce(true);

    await expect(assertCommitteeAccess(req, 'committee-1', 'get_weekly_brief_current', 'auditor', 'read')).resolves.toBeUndefined();
  });

  it('throws a 403 FORBIDDEN error when the caller has no grant', async () => {
    checkSingleAccessStrict.mockResolvedValueOnce(false);

    await expect(assertCommitteeAccess(req, 'committee-1', 'generate_weekly_brief', 'writer', 'write')).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  it('throws a 503 ACCESS_CHECK_UNAVAILABLE error when the access-check call fails, and logs a warning naming the verb', async () => {
    checkSingleAccessStrict.mockRejectedValueOnce(new Error('upstream down'));

    await expect(assertCommitteeAccess(req, 'committee-1', 'save_weekly_brief', 'writer', 'write')).rejects.toMatchObject({
      statusCode: 503,
      code: 'ACCESS_CHECK_UNAVAILABLE',
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(req, 'save_weekly_brief', expect.stringContaining('write access'), expect.anything());
  });

  it('checks the committee resource with the exact access relation passed in', async () => {
    checkSingleAccessStrict.mockResolvedValueOnce(true);

    await assertCommitteeAccess(req, 'committee-1', 'get_committee_engagement', 'auditor', 'read');

    expect(checkSingleAccessStrict).toHaveBeenCalledWith(req, { resource: 'committee', id: 'committee-1', access: 'auditor' });
  });
});
