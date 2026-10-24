// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

const { getObject, putConditionalObject, rolesOf } = vi.hoisted(() => ({ getObject: vi.fn(), putConditionalObject: vi.fn(), rolesOf: vi.fn() }));
vi.mock('./mktg-project-roles.service', () => ({
  MktgProjectRolesService: class {
    public rolesOf = rolesOf;
  },
}));
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
const roles = { ed: { name: 'Executive director', subject: 'auth0|ed' }, tocChair: { name: 'TOC chair', subject: 'auth0|chair' } };

describe('MktgSignOffSettingsService', () => {
  const service = new MktgSignOffSettingsService();
  beforeEach(() => {
    vi.resetAllMocks();
    getObject.mockResolvedValue(null);
    rolesOf.mockResolvedValue(roles);
  });

  it('defaults only a confirmed missing object to single-writer', async () => {
    getObject.mockResolvedValue(null);
    expect(await service.modeOf(req, 'synthetic-project')).toBe('single-writer');
    expect(getObject).toHaveBeenCalledWith(req, 'marketing-os-artifacts', 'project-settings/synthetic-project/sign-off.json');
    expect(rolesOf).not.toHaveBeenCalled();
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

  it('owns the read-to-roster policy orchestration and returns only name projections', async () => {
    const result = await service.readSettings(writer, 'canonical-project');
    expect(getObject).toHaveBeenCalledExactlyOnceWith(writer, 'marketing-os-artifacts', 'project-settings/canonical-project/sign-off.json');
    expect(rolesOf).toHaveBeenCalledExactlyOnceWith(writer, 'canonical-project');
    expect(result).toEqual({
      mode: 'single-writer',
      roles: { ed: { name: 'Executive director' }, tocChair: { name: 'TOC chair' } },
      canEnable: false,
      reason: 'Approver access policy is awaiting confirmation.',
    });
    expect(JSON.stringify(result)).not.toContain('auth0|');
    expect(putConditionalObject).not.toHaveBeenCalled();
  });

  it('keeps persisted two-role mode readable while B6 is unresolved and never projects the storage token', async () => {
    getObject.mockResolvedValue({ body: JSON.stringify(setting), etag: 'private-etag' });
    const result = await service.readSettings(writer, 'synthetic-project');
    expect(result).toMatchObject({ mode: 'two-role', canEnable: false });
    expect(JSON.stringify(result)).not.toContain('private-etag');
    expect(JSON.stringify(result)).not.toContain('auth0|');
  });

  it.each([
    { source: { ed: null, tocChair: roles.tocChair }, label: 'executive director' },
    { source: { ed: roles.ed, tocChair: { name: 'TOC chair', subject: null } }, label: 'TOC chair' },
  ])('owns the unresolved $label eligibility reason without exposing an identity', async ({ source, label }) => {
    rolesOf.mockResolvedValue(source);
    const result = await service.readSettings(writer, 'synthetic-project');
    expect(result).toMatchObject({ canEnable: false, reason: expect.stringContaining(label) });
    expect(JSON.stringify(result)).not.toContain('auth0|');
    expect(putConditionalObject).not.toHaveBeenCalled();
  });

  it.each([roles, { ed: null, tocChair: null }])('refuses enabling through the service itself until B6 is ruled', async (source) => {
    rolesOf.mockResolvedValue(source);
    await expect(service.updateMode(writer, 'synthetic-project', 'two-role')).rejects.toMatchObject({
      statusCode: 409,
      code: 'MKTG_SIGN_OFF_CANNOT_ENABLE',
    });
    expect(rolesOf).toHaveBeenCalledWith(writer, 'synthetic-project');
    expect(putConditionalObject).not.toHaveBeenCalled();
  });

  it('allows switching off with unresolved roles while preserving the server-observed CAS', async () => {
    getObject.mockResolvedValue({ body: JSON.stringify(setting), etag: 'observed-etag' });
    rolesOf.mockResolvedValue({ ed: null, tocChair: null });
    putConditionalObject.mockResolvedValue(true);
    const result = await service.updateMode(writer, 'synthetic-project', 'single-writer');
    expect(result).toMatchObject({ mode: 'single-writer', roles: { ed: null, tocChair: null }, canEnable: false });
    expect(putConditionalObject.mock.calls[0]?.[3]).toMatchObject({ ifMatch: 'observed-etag' });
    expect(putConditionalObject).toHaveBeenCalledTimes(1);
  });

  it('fails closed before writing when enable eligibility cannot resolve the roster', async () => {
    const failure = new MicroserviceError('Roster unavailable', 503, 'UNAVAILABLE');
    rolesOf.mockRejectedValue(failure);
    await expect(service.updateMode(writer, 'synthetic-project', 'two-role')).rejects.toBe(failure);
    expect(putConditionalObject).not.toHaveBeenCalled();
  });

  it('exposes a private observed etag with the parsed record but never invents one', async () => {
    getObject.mockResolvedValue({ body: JSON.stringify(setting), etag: 'observed-etag' });
    expect(await service.readSnapshot(req, 'synthetic-project')).toEqual({ record: setting, etag: 'observed-etag' });
  });

  it('creates absent settings conditionally with only opaque attribution', async () => {
    putConditionalObject.mockResolvedValue(true);
    const result = await service.updateMode(writer, 'synthetic-project', 'single-writer');
    expect(result).toMatchObject({ mode: 'single-writer', canEnable: false });
    expect(putConditionalObject).toHaveBeenCalledWith(
      writer,
      'marketing-os-artifacts',
      'project-settings/synthetic-project/sign-off.json',
      expect.objectContaining({ ifNoneMatch: '*', cacheControl: 'private, no-store' })
    );
    const input = putConditionalObject.mock.calls[0]?.[3];
    const stored = JSON.parse(input.body.toString());
    expect(stored).toEqual({ schema: setting.schema, mode: 'single-writer', changedBy: 'auth0|writer', changedAt: expect.any(String) });
    expect(Number.isFinite(Date.parse(stored.changedAt))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('auth0|');
    expect(input.ifMatch).toBeUndefined();
  });

  it('uses server-side ETag CAS on the observed snapshot, with no client version token', async () => {
    getObject.mockResolvedValue({ body: JSON.stringify(setting), etag: 'observed-etag' });
    putConditionalObject.mockResolvedValue(true);
    await service.updateMode(writer, 'synthetic-project', 'single-writer');
    expect(putConditionalObject.mock.calls[0]?.[3]).toMatchObject({ ifMatch: 'observed-etag' });
    expect(putConditionalObject.mock.calls[0]?.[3].ifNoneMatch).toBeUndefined();
  });

  it('does not retry a lost comparison or silently overwrite a concurrent edit', async () => {
    getObject.mockResolvedValue({ body: JSON.stringify(setting), etag: 'stale' });
    putConditionalObject.mockResolvedValue(false);
    await expect(service.updateMode(writer, 'synthetic-project', 'single-writer')).rejects.toMatchObject({ statusCode: 412 });
    expect(putConditionalObject).toHaveBeenCalledTimes(1);
    expect(getObject).toHaveBeenCalledTimes(1);
  });

  it('refuses writing an existing record without a conditional token', async () => {
    getObject.mockResolvedValue({ body: JSON.stringify(setting) });
    await expect(service.updateMode(writer, 'synthetic-project', 'single-writer')).rejects.toMatchObject({
      code: 'MKTG_SIGN_OFF_SETTINGS_UNREADABLE',
    });
    expect(putConditionalObject).not.toHaveBeenCalled();
  });

  it('blocks impersonation and a missing ordinary subject before any write', async () => {
    const impersonated = { ...writer, impersonationActive: true } as Request;
    await expect(service.updateMode(impersonated, 'synthetic-project', 'single-writer')).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.updateMode(req, 'synthetic-project', 'single-writer')).rejects.toMatchObject({ statusCode: 401 });
    expect(putConditionalObject).not.toHaveBeenCalled();
  });

  it('rejects an unsafe project before addressing storage', async () => {
    await expect(service.modeOf(req, '../unsafe')).rejects.toMatchObject({ statusCode: 400 });
    expect(getObject).not.toHaveBeenCalled();
  });
});
