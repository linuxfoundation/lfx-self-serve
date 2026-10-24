// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
const fake = vi.hoisted(() => ({ settings: vi.fn(), debug: vi.fn(), warning: vi.fn() }));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectSettings = fake.settings;
  },
}));
vi.mock('./logger.service', () => ({ logger: { debug: fake.debug, warning: fake.warning } }));
import { MicroserviceError, ResourceNotFoundError } from '../errors';
import { MktgAccessService } from './mktg-access.service';

const writer = { name: 'Synthetic writer', username: 'synthetic-writer', email: 'writer@example.test', avatar: 'https://images.example.test/writer.png' };
const director = { name: 'Synthetic lead', username: 'synthetic-lead', email: 'lead@example.test' };
const req = {} as Request;

describe('MktgAccessService', () => {
  beforeEach(() => vi.resetAllMocks());
  it('reads settings once and explicitly returns display fields, no auditors, email or subjects', async () => {
    fake.settings.mockResolvedValue({ writers: [{ ...writer, sub: 'opaque-subject' }], auditors: [director], executive_director: director });
    const result = await new MktgAccessService().read(req, 'synthetic-project');
    expect(fake.settings).toHaveBeenCalledExactlyOnceWith(req, 'synthetic-project');
    expect(result).toEqual({
      writers: [{ name: writer.name, username: writer.username, avatar: writer.avatar, isExecutiveDirector: false }],
      executiveDirector: { name: director.name, username: director.username, isExecutiveDirector: true },
      tocChair: null,
      warnings: [],
    });
    expect(JSON.stringify(result)).not.toMatch(/email|@|opaque-subject|auditors/);
  });
  it.each([
    { ...director, username: writer.username, email: 'different@example.test' },
    { ...director, username: undefined, email: ' WRITER@example.test ' },
  ])('marks merged roles by username or email-only match without sending email', async (lead) => {
    fake.settings.mockResolvedValue({ writers: [writer], executive_director: lead });
    const result = await new MktgAccessService().read(req, 'synthetic-project');
    expect(result.writers[0]?.isExecutiveDirector).toBe(true);
    expect(result.executiveDirector).not.toBeNull();
    expect(JSON.stringify(result)).not.toContain('@');
  });
  it('does not merge two distinct people by equal display names', async () => {
    fake.settings.mockResolvedValue({ writers: [writer], executive_director: { ...director, name: writer.name } });
    expect((await new MktgAccessService().read(req, 'synthetic-project')).writers[0]?.isExecutiveDirector).toBe(false);
  });
  it('omits absent optional display fields and does not match empty identity fields', async () => {
    fake.settings.mockResolvedValue({
      writers: [{ name: 'Synthetic writer', email: '', username: '', avatar: '' }],
      executive_director: { name: 'Synthetic lead', email: '', username: '' },
    });
    expect(await new MktgAccessService().read(req, 'synthetic-project')).toEqual({
      writers: [{ name: 'Synthetic writer', isExecutiveDirector: false }],
      executiveDirector: { name: 'Synthetic lead', isExecutiveDirector: true },
      tocChair: null,
      warnings: [],
    });
  });
  it('returns successful zero-writer settings and an absent ED honestly', async () => {
    fake.settings.mockResolvedValue({ writers: [] });
    const service = new MktgAccessService();
    expect(await service.read(req, 'synthetic-project')).toEqual({ writers: [], executiveDirector: null, tocChair: null, warnings: [] });
    expect(service.resolveTocChair()).toBeNull();
  });
  it.each([{}, { writers: undefined }])('accepts omitted writers as a successful empty settings read %#', async (settings) => {
    fake.settings.mockResolvedValue(settings);
    expect(await new MktgAccessService().read(req, 'synthetic-project')).toEqual({ writers: [], executiveDirector: null, tocChair: null, warnings: [] });
    expect(fake.warning).not.toHaveBeenCalled();
  });
  it.each([
    [{ username: 'synthetic-invite' }, 'synthetic-invite'],
    [{ name: '  ', username: 'synthetic-invite' }, 'synthetic-invite'],
    [{ name: 3 }, ''],
    [{}, ''],
    [{ name: ' Synthetic writer ' }, 'Synthetic writer'],
  ])('projects optional names with a trimmed username or empty fallback %#', async (person, name) => {
    fake.settings.mockResolvedValue({ writers: [person], executive_director: person });
    const result = await new MktgAccessService().read(req, 'synthetic-project');
    expect(result.writers[0]?.name).toBe(name);
    expect(result.executiveDirector?.name).toBe(name);
  });
  it('calls the TOC resolver seam for the response', async () => {
    fake.settings.mockResolvedValue({});
    const service = new MktgAccessService();
    const seam = vi.spyOn(service, 'resolveTocChair');
    expect((await service.read(req, 'synthetic-project')).tocChair).toBeNull();
    expect(seam).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 404])('preserves upstream status/code %s without leaking its message, body or cause', async (status) => {
    const upstream = new MicroserviceError('Private writer@example.test', status, 'SYNTHETIC_UPSTREAM', {
      errorBody: { details: 'Private writer@example.test' },
      originalMessage: 'Private writer@example.test',
    });
    fake.settings.mockRejectedValue(upstream);
    const failure = await new MktgAccessService().read(req, 'synthetic-project').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MicroserviceError);
    expect(failure).toMatchObject({
      statusCode: status,
      code: 'SYNTHETIC_UPSTREAM',
      operation: 'mktg_access_settings',
      service: 'mktg_access_service',
      path: '/projects/:uid/settings',
    });
    expect(fake.warning).toHaveBeenCalledExactlyOnceWith(req, 'mktg_access_settings', 'Project access settings read failed', {
      project: 'synthetic-project',
      upstream_status: status,
      upstream_code: 'SYNTHETIC_UPSTREAM',
    });
    expect(JSON.stringify([failure, fake.warning.mock.calls])).not.toContain('writer@example.test');
  });
  it('preserves a typed settings ResourceNotFoundError unchanged', async () => {
    const failure = new ResourceNotFoundError('Settings', 'synthetic-project');
    fake.settings.mockRejectedValue(failure);
    await expect(new MktgAccessService().read(req, 'synthetic-project')).rejects.toBe(failure);
    expect(fake.warning).toHaveBeenCalledWith(req, 'mktg_access_settings', expect.any(String), {
      project: 'synthetic-project',
      upstream_status: 404,
      upstream_code: failure.code,
    });
  });
  it('maps an upstream outage to a contextual 502 with only safe status/code logging', async () => {
    fake.settings.mockRejectedValue(new MicroserviceError('Private writer@example.test', 503, 'SYNTHETIC_OUTAGE'));
    const failure = await new MktgAccessService().read(req, 'synthetic-project').catch((error: unknown) => error);
    expect(failure).toMatchObject({
      statusCode: 502,
      code: 'MKTG_ACCESS_UNAVAILABLE',
      operation: 'mktg_access_settings',
      service: 'mktg_access_service',
      path: '/projects/:uid/settings',
    });
    expect(fake.warning).toHaveBeenCalledExactlyOnceWith(req, 'mktg_access_settings', expect.any(String), {
      project: 'synthetic-project',
      upstream_status: 503,
      upstream_code: 'SYNTHETIC_OUTAGE',
    });
    expect(JSON.stringify([failure, fake.warning.mock.calls])).not.toContain('writer@example.test');
  });
  it('turns unavailable or malformed settings into typed 502, never empty access', async () => {
    const service = new MktgAccessService();
    fake.settings.mockRejectedValueOnce(new Error('Synthetic settings failure'));
    await expect(service.read(req, 'synthetic-project')).rejects.toMatchObject({ statusCode: 502, code: 'MKTG_ACCESS_UNAVAILABLE' });
    for (const value of [null, [], { writers: null }, { writers: {} }, { writers: 3 }, { writers: [null] }, { writers: [[]] }, { executive_director: 0 }]) {
      fake.settings.mockResolvedValue(value);
      await expect(service.read(req, 'synthetic-project')).rejects.toMatchObject({
        statusCode: 502,
        code: 'MKTG_ACCESS_UNAVAILABLE',
        operation: 'mktg_access_settings',
        service: 'mktg_access_service',
        path: '/projects/:uid/settings',
      });
    }
    expect(JSON.stringify([fake.debug.mock.calls, fake.warning.mock.calls])).not.toContain('@');
  });
});
