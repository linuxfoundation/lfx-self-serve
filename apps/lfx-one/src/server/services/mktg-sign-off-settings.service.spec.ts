// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

const { getObject, putConditionalObject } = vi.hoisted(() => ({ getObject: vi.fn(), putConditionalObject: vi.fn() }));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public getObject = getObject;
    public putConditionalObject = putConditionalObject;
  },
}));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), info: vi.fn() } }));
import { MicroserviceError } from '../errors';
import { MktgSignOffSettingsService } from './mktg-sign-off-settings.service';

const req = {} as Request;
const setting = { schema: 'mktg-project-sign-off/v1', mode: 'two-role', changedAt: '2026-10-23T12:00:00Z', changedBy: 'auth0|writer' } as const;
const writer = { oidc: { user: { sub: 'auth0|writer' } } } as unknown as Request;

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

  it('exposes a private observed etag with the parsed record but never invents one', async () => {
    getObject.mockResolvedValue({ body: JSON.stringify(setting), etag: 'observed-etag' });
    expect(await service.readSnapshot(req, 'synthetic-project')).toEqual({ record: setting, etag: 'observed-etag' });
  });

  it('creates absent settings conditionally with only opaque attribution', async () => {
    putConditionalObject.mockResolvedValue(true);
    const result = await service.write(writer, 'synthetic-project', 'single-writer', { record: null });
    expect(result).toMatchObject({ schema: setting.schema, mode: 'single-writer', changedBy: 'auth0|writer' });
    expect(putConditionalObject).toHaveBeenCalledWith(
      writer,
      'marketing-os-artifacts',
      'project-settings/synthetic-project/sign-off.json',
      expect.objectContaining({ ifNoneMatch: '*', cacheControl: 'private, no-store' })
    );
    const input = putConditionalObject.mock.calls[0]?.[3];
    expect(JSON.parse(input.body.toString())).toEqual(result);
    expect(input.ifMatch).toBeUndefined();
  });

  it('updates using the caller-observed token and preserves the known mode shape', async () => {
    putConditionalObject.mockResolvedValue(true);
    await service.write(writer, 'synthetic-project', 'single-writer', { record: setting, etag: 'observed-etag' });
    expect(putConditionalObject.mock.calls[0]?.[3]).toMatchObject({ ifMatch: 'observed-etag' });
    expect(putConditionalObject.mock.calls[0]?.[3].ifNoneMatch).toBeUndefined();
  });

  it('does not retry a lost comparison or silently overwrite a concurrent edit', async () => {
    putConditionalObject.mockResolvedValue(false);
    await expect(service.write(writer, 'synthetic-project', 'single-writer', { record: setting, etag: 'stale' })).rejects.toMatchObject({ statusCode: 412 });
    expect(putConditionalObject).toHaveBeenCalledTimes(1);
    expect(getObject).not.toHaveBeenCalled();
  });

  it('refuses writing an existing record without a conditional token', async () => {
    await expect(service.write(writer, 'synthetic-project', 'single-writer', { record: setting })).rejects.toMatchObject({
      code: 'MKTG_SIGN_OFF_SETTINGS_UNREADABLE',
    });
    expect(putConditionalObject).not.toHaveBeenCalled();
  });

  it('blocks impersonation and a missing ordinary subject before any write', async () => {
    const impersonated = { ...writer, impersonationActive: true } as Request;
    await expect(service.write(impersonated, 'synthetic-project', 'single-writer', { record: null })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.write(req, 'synthetic-project', 'single-writer', { record: null })).rejects.toMatchObject({ statusCode: 401 });
    expect(putConditionalObject).not.toHaveBeenCalled();
  });

  it('rejects an unsafe project before addressing storage', async () => {
    await expect(service.modeOf(req, '../unsafe')).rejects.toMatchObject({ statusCode: 400 });
    expect(getObject).not.toHaveBeenCalled();
  });
});
