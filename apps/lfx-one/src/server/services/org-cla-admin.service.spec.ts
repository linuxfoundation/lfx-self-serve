// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { debug, warning } = vi.hoisted(() => ({ debug: vi.fn(), warning: vi.fn() }));

vi.mock('./logger.service', () => ({ logger: { debug, warning, info: vi.fn(), error: vi.fn() } }));
vi.mock('./access-check.service', () => ({ AccessCheckService: class {} }));

const { OrgClaAdminService } = await import('./org-cla-admin.service');

const OWN = '0014100000Te2ovAAB';

function build(checkSingleAccessStrict: ReturnType<typeof vi.fn>): InstanceType<typeof OrgClaAdminService> {
  return new OrgClaAdminService({ checkSingleAccessStrict } as never);
}

function req(): Request {
  return {} as Request;
}

describe('OrgClaAdminService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks the authorizer for b2b_org#cla_admin on exactly the requested organization', async () => {
    const check = vi.fn().mockResolvedValue(true);

    await expect(build(check).holds(req(), OWN)).resolves.toBe(true);

    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith(expect.anything(), { resource: 'b2b_org', id: OWN, access: 'cla_admin' });
  });

  it('answers false when the authorizer says no', async () => {
    await expect(build(vi.fn().mockResolvedValue(false)).holds(req(), OWN)).resolves.toBe(false);
  });

  it('answers false, logged at debug and never as a warning, when the check fails', async () => {
    const check = vi.fn().mockRejectedValue(new Error('relation cla_admin not found'));

    await expect(build(check).holds(req(), OWN)).resolves.toBe(false);

    expect(debug).toHaveBeenCalledWith(expect.anything(), 'check_org_cla_admin', expect.any(String), expect.objectContaining({ org_uid: OWN }));
    expect(warning).not.toHaveBeenCalled();
  });

  it('keeps a failed check apart from a verified no in `status`', async () => {
    await expect(build(vi.fn().mockResolvedValue(true)).status(req(), OWN)).resolves.toBe('held');
    await expect(build(vi.fn().mockResolvedValue(false)).status(req(), OWN)).resolves.toBe('not-held');
    await expect(build(vi.fn().mockRejectedValue(new Error('down'))).status(req(), OWN)).resolves.toBe('unknown');
  });

  it('checks once per request and organization', async () => {
    const check = vi.fn().mockResolvedValue(true);
    const service = build(check);
    const shared = req();

    await service.holds(shared, OWN);
    await service.holds(shared, OWN);
    await service.holds(req(), OWN);

    expect(check).toHaveBeenCalledTimes(2);
  });
});
