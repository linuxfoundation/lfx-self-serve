// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MAX_SNOWFLAKE_PAGINATION_PAGE } from '@lfx-one/shared/constants';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getOrgCertifications, getOrgTrainings, logger } = vi.hoisted(() => ({
  getOrgCertifications: vi.fn(),
  getOrgTrainings: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

// validation.helper imports `@lfx-one/shared/utils`, whose barrel pulls Angular; see validation.helper.spec.ts.
// The real pagination parsing is what runs here.
vi.mock('@lfx-one/shared/utils', () => ({}));
vi.mock('../services/org-lens-training.service', () => ({
  OrgLensTrainingService: class {
    public getOrgCertifications = getOrgCertifications;
    public getOrgTrainings = getOrgTrainings;
  },
}));
vi.mock('../services/logger.service', () => ({ logger }));

import { OrgLensTrainingController } from './org-lens-training.controller';

const ORG_UID = '001410000000000AAA';

function buildReq(query: Record<string, unknown>): Request {
  return { params: { orgUid: ORG_UID }, query, path: '/test' } as unknown as Request;
}

function buildRes(): Response {
  return { setHeader: vi.fn(), json: vi.fn() } as unknown as Response;
}

describe('OrgLensTrainingController pagination', () => {
  const controller = new OrgLensTrainingController();

  beforeEach(() => {
    vi.clearAllMocks();
    getOrgCertifications.mockResolvedValue({ data: [], total: 0 });
    getOrgTrainings.mockResolvedValue({ data: [], total: 0 });
  });

  it.each([
    ['certifications', getOrgCertifications, (req: Request, res: Response, next: NextFunction) => controller.getOrgCertifications(req, res, next)],
    ['trainings', getOrgTrainings, (req: Request, res: Response, next: NextFunction) => controller.getOrgTrainings(req, res, next)],
  ] as const)('%s: caps an oversized offset and truncates a fractional one before the service', async (_name, serviceMethod, handler) => {
    const next = vi.fn();

    await handler(buildReq({ offset: '9999999999999999999999999', pageSize: '100' }), buildRes(), next);
    await handler(buildReq({ offset: '0.5', pageSize: '100' }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(serviceMethod.mock.calls[0][2]).toMatchObject({ offset: MAX_SNOWFLAKE_PAGINATION_PAGE * 100, pageSize: 100 });
    expect(serviceMethod.mock.calls[1][2]).toMatchObject({ offset: 0, pageSize: 100 });
  });
});
