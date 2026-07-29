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

import { assertCommitteeRead } from './committee-read-access.helper';

const req = {} as unknown as Request;

describe('assertCommitteeRead', () => {
  beforeEach(() => {
    checkSingleAccessStrict.mockReset();
    warning.mockReset();
  });

  it('resolves without throwing when the caller has a viewer grant', async () => {
    checkSingleAccessStrict.mockResolvedValueOnce(true);

    await expect(assertCommitteeRead(req, 'committee-1', 'get_committee_engagement')).resolves.toBeUndefined();
  });

  it('throws a 403 FORBIDDEN error when the caller has no grant', async () => {
    checkSingleAccessStrict.mockResolvedValueOnce(false);

    await expect(assertCommitteeRead(req, 'committee-1', 'get_committee_engagement')).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  it('throws a 503 ACCESS_CHECK_UNAVAILABLE error when the access-check call fails, and logs a warning', async () => {
    checkSingleAccessStrict.mockRejectedValueOnce(new Error('upstream down'));

    await expect(assertCommitteeRead(req, 'committee-1', 'get_committee_engagement')).rejects.toMatchObject({
      statusCode: 503,
      code: 'ACCESS_CHECK_UNAVAILABLE',
    });
    expect(warning).toHaveBeenCalledOnce();
  });

  it('checks the committee resource with the viewer relation', async () => {
    checkSingleAccessStrict.mockResolvedValueOnce(true);

    await assertCommitteeRead(req, 'committee-1', 'get_committee_engagement');

    expect(checkSingleAccessStrict).toHaveBeenCalledWith(req, { resource: 'committee', id: 'committee-1', access: 'viewer' });
  });
});
