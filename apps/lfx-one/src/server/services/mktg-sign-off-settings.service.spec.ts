// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

const getObject = vi.hoisted(() => vi.fn());
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public getObject = getObject;
  },
}));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn() } }));
import { MicroserviceError } from '../errors';
import { MktgSignOffSettingsService } from './mktg-sign-off-settings.service';

const req = {} as Request;
const setting = { schema: 'mktg-project-sign-off/v1', mode: 'two-role', changedAt: '2026-10-23T12:00:00Z', changedBy: 'auth0|writer' };

describe('MktgSignOffSettingsService', () => {
  const service = new MktgSignOffSettingsService();
  beforeEach(() => vi.resetAllMocks());

  it('defaults only a confirmed missing object to single-writer', async () => {
    getObject.mockResolvedValue(null);
    expect(await service.modeOf(req, 'synthetic-project')).toBe('single-writer');
    expect(getObject).toHaveBeenCalledWith(req, 'marketing-os-artifacts', 'project-settings/synthetic-project/sign-off.json');
  });

  it.each(['single-writer', 'two-role'])('reads the persisted %s policy without caching across writes', async (mode) => {
    getObject.mockResolvedValue({ body: JSON.stringify({ ...setting, mode, changedBy: null }) });
    expect(await service.modeOf(req, 'synthetic-project')).toBe(mode);
    getObject.mockResolvedValue({ body: JSON.stringify({ ...setting, mode: 'single-writer' }) });
    expect(await service.modeOf(req, 'synthetic-project')).toBe('single-writer');
    expect(getObject).toHaveBeenCalledTimes(2);
  });

  it.each([
    '{',
    'null',
    '[]',
    '{}',
    JSON.stringify({ ...setting, schema: 'future/v2' }),
    JSON.stringify({ ...setting, mode: 'unknown' }),
    JSON.stringify({ ...setting, changedAt: 'invalid' }),
    JSON.stringify({ ...setting, changedBy: '' }),
  ])('fails closed for unreadable policy %s', async (body) => {
    getObject.mockResolvedValue({ body });
    await expect(service.modeOf(req, 'synthetic-project')).rejects.toMatchObject({ statusCode: 502, code: 'MKTG_SIGN_OFF_SETTINGS_UNREADABLE' });
  });

  it('propagates an outage rather than treating it as a missing setting', async () => {
    const failure = new MicroserviceError('unavailable', 503, 'UNAVAILABLE');
    getObject.mockRejectedValue(failure);
    await expect(service.modeOf(req, 'synthetic-project')).rejects.toBe(failure);
  });

  it('rejects an unsafe project before addressing storage', async () => {
    await expect(service.modeOf(req, '../unsafe')).rejects.toMatchObject({ statusCode: 400 });
    expect(getObject).not.toHaveBeenCalled();
  });
});
