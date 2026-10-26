// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensEmployerAffiliation } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEmployerAffiliation, getEffectiveUsername } = vi.hoisted(() => ({
  getEmployerAffiliation: vi.fn(),
  getEffectiveUsername: vi.fn(),
}));

vi.mock('../services/org-lens-employer-affiliation.service', () => ({
  OrgLensEmployerAffiliationService: class {
    public getEmployerAffiliation = getEmployerAffiliation;
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(), success: vi.fn(), debug: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { logger } from '../services/logger.service';
import { OrgLensEmployerAffiliationController } from './org-lens-employer-affiliation.controller';

const AFFILIATION: OrgLensEmployerAffiliation = { employerName: 'Delta Harbour', hasActiveMembership: false };

function harness() {
  const json = vi.fn();
  const next: NextFunction = vi.fn();
  return {
    controller: new OrgLensEmployerAffiliationController(),
    req: { path: '/api/profile/employer-affiliation' } as Request,
    res: { json } as unknown as Response,
    next,
    json,
  };
}

describe('OrgLensEmployerAffiliationController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // This route is deliberately outside the Org Lens read gate, so its own identity check is the only guard.
  it('refuses a caller with no resolvable LFID without asking CDP or Snowflake', async () => {
    const h = harness();
    getEffectiveUsername.mockReturnValue(null);

    await h.controller.getEmployerAffiliation(h.req, h.res, h.next);

    expect(getEmployerAffiliation).not.toHaveBeenCalled();
    expect(h.json).not.toHaveBeenCalled();
    expect(h.next).toHaveBeenCalledWith(expect.objectContaining({ name: 'AuthenticationError' }));
  });

  it('answers the affiliation for the effective LFID', async () => {
    const h = harness();
    getEffectiveUsername.mockReturnValue('lfid-1');
    getEmployerAffiliation.mockResolvedValue(AFFILIATION);

    await h.controller.getEmployerAffiliation(h.req, h.res, h.next);

    expect(getEmployerAffiliation).toHaveBeenCalledWith(h.req, 'lfid-1');
    expect(h.json).toHaveBeenCalledWith(AFFILIATION);
    expect(h.next).not.toHaveBeenCalled();
  });

  // A username is PII in a log sink, and `logger.success` does not redact its metadata.
  it('never writes the caller LFID to the success log', async () => {
    const h = harness();
    getEffectiveUsername.mockReturnValue('lfid-1');
    getEmployerAffiliation.mockResolvedValue(AFFILIATION);

    await h.controller.getEmployerAffiliation(h.req, h.res, h.next);

    const metadata = vi.mocked(logger.success).mock.calls[0][3];
    expect(JSON.stringify(metadata)).not.toContain('lfid-1');
    expect(metadata).toEqual({ has_employer: true, has_active_membership: false });
  });

  it('forwards an upstream failure instead of answering a default', async () => {
    const h = harness();
    const failure = new Error('snowflake down');
    getEffectiveUsername.mockReturnValue('lfid-1');
    getEmployerAffiliation.mockRejectedValue(failure);

    await h.controller.getEmployerAffiliation(h.req, h.res, h.next);

    expect(h.json).not.toHaveBeenCalled();
    expect(h.next).toHaveBeenCalledWith(failure);
  });
});
