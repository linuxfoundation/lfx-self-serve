// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MEMBER_360_TRACKER_TTL_MS, MEMBER_360_TRACKER_SWEEP_LIMIT } from '@lfx-one/shared/constants';
import { Member360TrackerStoreService } from './member-360-tracker-store.service';
import { logger } from './logger.service';

const mocks = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), remove: vi.fn(), list: vi.fn(), subject: 'synthetic-creator' }));
vi.mock('./logger.service', () => ({ logger: { warning: vi.fn() } }));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    putPrivateObjectIfAbsent = mocks.put;
    getPrivateObject = mocks.get;
    deletePrivateObject = mocks.remove;
    listObjects = mocks.list;
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveSub: () => mocks.subject }));
const req = {} as Request;
const tracker = { filename: 'tracker.csv', rows: [{ company: 'Sample Member', email: 'synthetic-contact@example.test' }] };
let objects: Map<string, { body: string }>;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.subject = 'synthetic-creator';
  mocks.list.mockResolvedValue([]);
  objects = new Map();
  mocks.put.mockImplementation(async (_req, purpose, key, input) => {
    expect(purpose).toBe('marketing-os-artifacts');
    objects.set(key, { body: input.body.toString() });
    return true;
  });
  mocks.get.mockImplementation(async (_req, _purpose, key) => objects.get(key) ?? null);
  mocks.remove.mockImplementation(async (_req, _purpose, key) => {
    objects.delete(key);
  });
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
      expect(objects.size).toBe(0);
      expect(mocks.remove).toHaveBeenCalledWith(req, 'marketing-os-artifacts', expect.stringContaining(receipt.trackerId));
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
    objects.set(key, object);
    await expect(service.load(req, 'project-one', [receipt.trackerId])).rejects.toMatchObject(unavailable);
    objects.clear();
    await expect(service.load(req, 'project-one', [receipt.trackerId])).rejects.toMatchObject(unavailable);
  });
  it('rejects invalid keys before storage, unauthenticated access and aggregate oversized rows', async () => {
    const service = new Member360TrackerStoreService();
    const invalid = { validationErrors: [expect.objectContaining({ field: 'trackerIds', message: expect.stringContaining('tracker ids') })] };
    await expect(service.load(req, '../other', ['a'.repeat(64)])).rejects.toMatchObject({ validationErrors: [expect.objectContaining({ field: 'project' })] });
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
  it('allows only the uploading creator to remove rows and treats an already-gone id as success', async () => {
    const service = new Member360TrackerStoreService();
    const receipt = await service.save(req, 'project-one', tracker);
    mocks.subject = 'synthetic-other';
    await expect(service.remove(req, 'project-one', receipt.trackerId)).rejects.toMatchObject({ statusCode: 404 });
    expect(objects.size).toBe(1);
    expect(mocks.remove).not.toHaveBeenCalled();
    mocks.subject = 'synthetic-creator';
    await service.remove(req, 'project-one', receipt.trackerId);
    await service.remove(req, 'project-one', receipt.trackerId);
    expect(objects.size).toBe(0);
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it('sweeps only expired valid project keys, leaves fresh/foreign keys and never reads rows', async () => {
    const prefix = 'member-360-trackers/project-one/';
    const old = `${prefix}${'a'.repeat(64)}.json`,
      fresh = `${prefix}${'b'.repeat(64)}.json`,
      foreign = `member-360-trackers/project-two/${'c'.repeat(64)}.json`;
    for (const key of [old, fresh, foreign]) objects.set(key, { body: 'private rows must not be read' });
    const past = new Date(Date.now() - MEMBER_360_TRACKER_TTL_MS - 1);
    mocks.list.mockResolvedValue([
      { key: old, lastModified: past },
      { key: fresh, lastModified: new Date() },
      { key: foreign, lastModified: past },
      { key: `${prefix}invalid.json`, lastModified: past },
    ]);
    await new Member360TrackerStoreService().sweepExpired(req, 'project-one');
    expect(objects.has(old)).toBe(false);
    expect(objects.has(fresh)).toBe(true);
    expect(objects.has(foreign)).toBe(true);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalledWith(req, 'marketing-os-artifacts', prefix);
  });
  it('caps sweep deletion attempts and processes the oldest first', async () => {
    const now = Date.now();
    const entries = Array.from({ length: MEMBER_360_TRACKER_SWEEP_LIMIT + 3 }, (_, n) => ({
      key: `member-360-trackers/project-one/${n.toString(16).padStart(64, '0')}.json`,
      lastModified: new Date(now - MEMBER_360_TRACKER_TTL_MS - n - 1),
    }));
    for (const entry of entries) objects.set(entry.key, { body: 'private' });
    mocks.list.mockResolvedValue(entries);
    await new Member360TrackerStoreService().sweepExpired(req, 'project-one');
    expect(mocks.remove).toHaveBeenCalledTimes(MEMBER_360_TRACKER_SWEEP_LIMIT);
    expect(mocks.remove.mock.calls[0][2]).toBe(entries.at(-1)?.key);
    expect(objects.size).toBe(3);
  });
  it('keeps sweeps best-effort without logging private provider errors', async () => {
    mocks.list.mockRejectedValue(new Error('private-row@example.test'));
    await expect(new Member360TrackerStoreService().sweepExpired(req, 'project-one')).resolves.toBeUndefined();
    expect(JSON.stringify(vi.mocked(logger.warning).mock.calls)).not.toContain('private-row');
  });
  it('deletes consumed private rows and makes the receipt unavailable', async () => {
    const service = new Member360TrackerStoreService();
    const receipt = await service.save(req, 'project-one', tracker);
    await service.load(req, 'project-one', [receipt.trackerId]);
    await service.deleteConsumed(req, 'project-one', [receipt.trackerId]);
    expect(objects.size).toBe(0);
    expect(mocks.remove).toHaveBeenCalledOnce();
    await expect(service.load(req, 'project-one', [receipt.trackerId])).rejects.toMatchObject({ statusCode: 400 });
  });
  it('retries a transient erase failure once without a warning', async () => {
    const service = new Member360TrackerStoreService();
    const receipt = await service.save(req, 'project-one', tracker);
    mocks.remove.mockRejectedValueOnce(new Error('private-row@example.test'));
    await service.deleteConsumed(req, 'project-one', [receipt.trackerId]);
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(objects.size).toBe(0);
    expect(logger.warning).not.toHaveBeenCalled();
  });
  it('rejects explicit Remove after two failed erases rather than pretending it succeeded', async () => {
    const service = new Member360TrackerStoreService();
    const receipt = await service.save(req, 'project-one', tracker);
    mocks.remove.mockRejectedValue(new Error('Synthetic deletion unavailable'));
    await expect(service.remove(req, 'project-one', receipt.trackerId)).rejects.toThrow('Synthetic deletion unavailable');
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(objects.size).toBe(1);
  });
  it('keeps persistent cleanup failures best-effort after one retry and logs no row data', async () => {
    const service = new Member360TrackerStoreService();
    const receipt = await service.save(req, 'project-one', tracker);
    mocks.remove.mockRejectedValue(new Error('private-row@example.test'));
    await expect(service.deleteConsumed(req, 'project-one', [receipt.trackerId])).resolves.toBeUndefined();
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(logger.warning).toHaveBeenCalledWith(req, 'member_360_tracker_delete', expect.any(String), { reason: 'consumed', trackerId: receipt.trackerId });
    expect(JSON.stringify(vi.mocked(logger.warning).mock.calls)).not.toContain('private-row');
  });
  it('fails closed on a write outage or collision', async () => {
    mocks.put.mockResolvedValue(false);
    await expect(new Member360TrackerStoreService().save(req, 'project-one', tracker)).rejects.toMatchObject({ code: 'MEMBER_360_TRACKER_STORE_UNAVAILABLE' });
  });
});
