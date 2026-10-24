// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
const fake = vi.hoisted(() => ({ settings: vi.fn(), debug: vi.fn() }));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectSettings = fake.settings;
  },
}));
vi.mock('./logger.service', () => ({ logger: { debug: fake.debug } }));
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
      warnings: [],
    });
  });
  it('returns successful zero-writer settings and an absent ED honestly', async () => {
    fake.settings.mockResolvedValue({ writers: [] });
    const service = new MktgAccessService();
    expect(await service.read(req, 'synthetic-project')).toEqual({ writers: [], executiveDirector: null, warnings: [] });
    expect(service.resolveTocChair()).toBeNull();
  });
  it('turns unavailable or malformed settings into typed 502, never empty access', async () => {
    const service = new MktgAccessService();
    fake.settings.mockRejectedValueOnce(new Error('Synthetic settings failure'));
    await expect(service.read(req, 'synthetic-project')).rejects.toMatchObject({ statusCode: 502, code: 'MKTG_ACCESS_UNAVAILABLE' });
    for (const value of [null, {}, { writers: null }, { writers: [null] }, { writers: [{ name: 3 }] }, { writers: [], executive_director: {} }]) {
      fake.settings.mockResolvedValue(value);
      await expect(service.read(req, 'synthetic-project')).rejects.toMatchObject({ statusCode: 502, code: 'MKTG_ACCESS_UNAVAILABLE' });
    }
    expect(JSON.stringify(fake.debug.mock.calls)).not.toContain('@');
  });
});
