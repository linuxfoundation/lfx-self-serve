// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MEMBER_360_TRACKER_TTL_MS } from '@lfx-one/shared/constants';
import { Member360TrackerStoreService } from './member-360-tracker-store.service';

const mocks = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), subject: 'synthetic-creator' }));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    putPrivateObjectIfAbsent = mocks.put;
    getPrivateObject = mocks.get;
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveSub: () => mocks.subject }));
const req = {} as Request;
const tracker = { filename: 'tracker.csv', rows: [{ company: 'Sample Member', email: 'synthetic-contact@example.test' }] };
let objects: Map<string, { body: string }>;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.subject = 'synthetic-creator';
  objects = new Map();
  mocks.put.mockImplementation(async (_req, purpose, key, input) => {
    expect(purpose).toBe('marketing-os-artifacts');
    objects.set(key, { body: input.body.toString() });
    return true;
  });
  mocks.get.mockImplementation(async (_req, _purpose, key) => objects.get(key) ?? null);
});

describe('private parsed Member 360 tracker store', () => {
  it('returns counts and an opaque id, never rows, headers, filenames or identities', async () => {
    const service = new Member360TrackerStoreService();
    const receipt = await service.save(req, 'project-one', tracker);
    expect(receipt).toEqual({
      trackerId: expect.stringMatching(/^[0-9a-f]{64}$/),
      rowCount: 1,
      columnCount: 2,
      byteCount: Buffer.byteLength(JSON.stringify(tracker)),
    });
    expect(JSON.stringify(receipt)).not.toMatch(/synthetic-contact|email|tracker.csv|Sample Member/);
    expect(await new Member360TrackerStoreService().load(req, 'project-one', [receipt.trackerId])).toEqual([tracker]);
    const record = JSON.parse([...objects.values()][0].body);
    expect(record.expiresAt).toBeGreaterThan(Date.now());
    expect(record.expiresAt).toBeLessThanOrEqual(Date.now() + MEMBER_360_TRACKER_TTL_MS);
    expect(record.creatorHash).not.toContain('synthetic-creator');
  });
  it('keeps an interrupted intake usable for six hours and rejects it at expiry', async () => {
    const now = 1_800_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      expect(MEMBER_360_TRACKER_TTL_MS).toBe(6 * 60 * 60 * 1000);
      const service = new Member360TrackerStoreService();
      const receipt = await service.save(req, 'project-one', tracker);
      clock.mockReturnValue(now + 2 * 60 * 60 * 1000);
      expect(await service.load(req, 'project-one', [receipt.trackerId])).toEqual([tracker]);
      clock.mockReturnValue(now + 6 * 60 * 60 * 1000);
      await expect(service.load(req, 'project-one', [receipt.trackerId])).rejects.toMatchObject({
        validationErrors: [expect.objectContaining({ field: 'trackerIds', message: expect.stringContaining('expired') })],
      });
    } finally {
      clock.mockRestore();
    }
  });

  it('refuses another project or creator and expired, missing or malformed records without quoting rows', async () => {
    const service = new Member360TrackerStoreService();
    const receipt = await service.save(req, 'project-one', tracker);
    const unavailable = { validationErrors: [expect.objectContaining({ field: 'trackerIds', message: expect.stringContaining('unavailable or expired') })] };
    await expect(service.load(req, 'project-two', [receipt.trackerId])).rejects.toMatchObject(unavailable);
    mocks.subject = 'synthetic-other';
    await expect(service.load(req, 'project-one', [receipt.trackerId])).rejects.toMatchObject(unavailable);
    mocks.subject = 'synthetic-creator';
    const key = [...objects.keys()][0];
    const object = objects.get(key);
    if (!object) throw new Error('Missing fixture');
    object.body = JSON.stringify({ ...JSON.parse(object.body), expiresAt: Date.now() - 1 });
    await expect(service.load(req, 'project-one', [receipt.trackerId])).rejects.toMatchObject(unavailable);
    object.body = 'invalid private-row@example.test';
    await expect(service.load(req, 'project-one', [receipt.trackerId])).rejects.toMatchObject(unavailable);
    objects.clear();
    await expect(service.load(req, 'project-one', [receipt.trackerId])).rejects.toMatchObject(unavailable);
  });
  it('rejects invalid keys before storage, unauthenticated access and aggregate oversized rows', async () => {
    const service = new Member360TrackerStoreService();
    const invalid = { validationErrors: [expect.objectContaining({ field: 'trackerIds', message: expect.stringContaining('tracker ids') })] };
    await expect(service.load(req, '../other', ['a'.repeat(64)])).rejects.toMatchObject(invalid);
    await expect(service.load(req, 'project-one', ['../private'])).rejects.toMatchObject(invalid);
    expect(mocks.get).not.toHaveBeenCalled();
    mocks.subject = '';
    await expect(service.save(req, 'project-one', tracker)).rejects.toThrow('Sign in');
    mocks.subject = 'synthetic-creator';
    const large = { ...tracker, rows: [{ company: 'x'.repeat(3_000_000) }] };
    const receipt = await service.save(req, 'project-one', large);
    await expect(service.load(req, 'project-one', [receipt.trackerId, receipt.trackerId])).rejects.toMatchObject({
      validationErrors: [expect.objectContaining({ message: expect.stringContaining('together must be smaller') })],
    });
  });
  it('fails closed on a write outage or collision', async () => {
    mocks.put.mockResolvedValue(false);
    await expect(new Member360TrackerStoreService().save(req, 'project-one', tracker)).rejects.toMatchObject({ code: 'MEMBER_360_TRACKER_STORE_UNAVAILABLE' });
  });
});
