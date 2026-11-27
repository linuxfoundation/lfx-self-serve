// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MKTG_RUN_SLOT_CLAIM_ATTEMPTS, MKTG_RUN_SLOT_SCHEMA, MKTG_RUN_SLOT_TTL_MS } from '@lfx-one/shared/constants';
import type { MktgRunSlot, MktgRunSlotMarker, ObjectStorePutInput } from '@lfx-one/shared/interfaces';
import { buildMktgRunSlotKey } from '@lfx-one/shared/utils';
import { logger } from './logger.service';
import { MktgRunSlotService } from './mktg-run-slot.service';

/** The store's contract in memory: every write is conditional, and each one gives the object a new version. */
const store = vi.hoisted(() => ({
  objects: new Map<string, { body: string; version: number }>(),
  versions: 0,
  omitEtag: false,
  loseCreates: false,
  puts: [] as { ifMatch?: string; ifNoneMatch?: string }[],
  read: vi.fn(),
}));
vi.mock('./logger.service', () => ({ logger: { warning: vi.fn(), debug: vi.fn() } }));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public async getPrivateObject(_req: unknown, purpose: string, key: string) {
      expect(purpose).toBe('marketing-os-artifacts');
      // Read first, then yield: whatever the hook writes lands between this read and the caller's conditional write.
      const object = store.objects.get(key);
      await store.read();
      return object ? { body: object.body, metadata: {}, etag: store.omitEtag ? undefined : String(object.version) } : null;
    }
    public async putPrivateObjectIfAbsent(_req: unknown, _purpose: string, key: string, input: ObjectStorePutInput) {
      store.puts.push({ ifNoneMatch: '*' });
      if (store.loseCreates || store.objects.has(key)) return false;
      store.objects.set(key, { body: Buffer.from(input.body).toString('utf8'), version: ++store.versions });
      return true;
    }
    public async putConditionalObject(_req: unknown, _purpose: string, key: string, input: ObjectStorePutInput, privateKey?: boolean) {
      expect(privateKey).toBe(true);
      store.puts.push({ ifMatch: input.ifMatch });
      if (input.ifMatch !== String(store.objects.get(key)?.version)) return false;
      store.objects.set(key, { body: Buffer.from(input.body).toString('utf8'), version: ++store.versions });
      return true;
    }
  },
}));

const req = {} as Request;
const slot: MktgRunSlot = { project: 'synthetic-project', agentKey: 'brand-kit', slotId: 'a'.repeat(64) };
const key = buildMktgRunSlotKey(slot);
const scope = { project: slot.project, agentKey: slot.agentKey };
const saved = (): MktgRunSlotMarker => JSON.parse(store.objects.get(key)?.body ?? '{}');

describe('MktgRunSlotService', () => {
  let service: MktgRunSlotService;
  /** A claim that must hold the slot. */
  const hold = async (subject: string | null): Promise<MktgRunSlotMarker> => {
    const { held } = await service.claim(req, slot, subject);
    if (!held) throw new Error('The synthetic claim must hold the slot');
    return held;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-19T12:00:00Z');
    vi.clearAllMocks();
    store.read.mockReset();
    store.objects.clear();
    Object.assign(store, { versions: 0, omitEtag: false, loseCreates: false, puts: [] });
    service = new MktgRunSlotService();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates the reservation only when none exists, and answers a later claim with its holder', async () => {
    const held = await hold('synthetic-writer-a');
    expect(held).toEqual({
      schema: MKTG_RUN_SLOT_SCHEMA,
      ...slot,
      claim: expect.stringMatching(/^[0-9a-f-]{36}$/),
      creatorSubject: 'synthetic-writer-a',
      startedAt: '2026-10-19T12:00:00.000Z',
      expiresAt: Date.now() + MKTG_RUN_SLOT_TTL_MS,
    });
    expect(saved()).toEqual(held);
    vi.advanceTimersByTime(MKTG_RUN_SLOT_TTL_MS - 1);
    // A live reservation is answered, never written over: the one write so far is the create-if-absent.
    expect(await service.claim(req, slot, 'synthetic-writer-b')).toEqual({ held: null, holder: held });
    expect(store.puts).toEqual([{ ifNoneMatch: '*' }]);
  });

  it('gives two simultaneous claims of an empty slot exactly one reservation', async () => {
    const [first, second] = await Promise.all([
      service.claim(req, slot, 'synthetic-writer-a'),
      new MktgRunSlotService().claim(req, slot, 'synthetic-writer-b'),
    ]);
    expect(first.held).toMatchObject({ creatorSubject: 'synthetic-writer-a' });
    // The loser's create-if-absent was refused; its next read names the winner.
    expect(second).toEqual({ held: null, holder: first.held });
    expect(saved()).toEqual(first.held);
  });

  it('releases its own reservation over the version read, and the next claim writes over that exact version', async () => {
    const first = await hold('synthetic-writer-a');
    await service.release(req, first);
    expect(saved()).toEqual({ ...first, expiresAt: 0 });
    expect(logger.debug).toHaveBeenCalledWith(req, 'mktg_run_slot_release', expect.any(String), scope);
    const second = await hold(null);
    expect(second).toMatchObject({ creatorSubject: null });
    expect(second.claim).not.toBe(first.claim);
    expect(store.puts).toEqual([{ ifNoneMatch: '*' }, { ifMatch: '1' }, { ifMatch: '2' }]);
  });

  it('writes over an expired reservation, and a late release never frees the start that took the slot', async () => {
    const first = await hold('synthetic-writer-a');
    vi.advanceTimersByTime(MKTG_RUN_SLOT_TTL_MS);
    const second = await hold('synthetic-writer-b');
    await service.release(req, first);
    expect(logger.warning).toHaveBeenCalledWith(req, 'mktg_run_slot_release', expect.stringContaining('no longer held'), scope);
    expect(saved()).toEqual(second);
    expect(await service.claim(req, slot, null)).toEqual({ held: null, holder: second });
  });

  it('does not release over a version another start has written since the read', async () => {
    const first = await hold('synthetic-writer-a');
    // Between this release's read and its write, the reservation expires and another start takes the slot.
    store.read.mockImplementationOnce(() => {
      store.objects.set(key, { body: JSON.stringify({ ...first, claim: 'synthetic-newer-claim' }), version: ++store.versions });
    });
    await service.release(req, first);
    expect(saved()).toMatchObject({ claim: 'synthetic-newer-claim', expiresAt: first.expiresAt });
    expect(logger.warning).toHaveBeenCalledWith(req, 'mktg_run_slot_release', expect.stringContaining('no longer held'), scope);
  });

  it('writes over an unreadable reservation, and refuses naming nobody when it has no version to write over', async () => {
    store.objects.set(key, { body: 'not a reservation', version: ++store.versions });
    store.omitEtag = true;
    expect(await service.claim(req, slot, 'synthetic-writer-a')).toEqual({ held: null, holder: null });
    expect(store.puts).toEqual([]);
    expect(store.objects.get(key)?.body).toBe('not a reservation');
    store.omitEtag = false;
    expect(await hold('synthetic-writer-a')).toEqual(saved());
    expect(logger.warning).toHaveBeenCalledWith(req, 'mktg_run_slot_claim', expect.stringContaining('unreadable'), scope);
  });

  it('stops after its bounded attempts when every write is lost and no holder can be read', async () => {
    store.loseCreates = true;
    expect(await service.claim(req, slot, 'synthetic-writer-a')).toEqual({ held: null, holder: null });
    expect(store.puts).toHaveLength(MKTG_RUN_SLOT_CLAIM_ATTEMPTS);
    expect(store.objects.has(key)).toBe(false);
  });

  it('lets a store failure fail the claim, and never lets one fail a release', async () => {
    store.read.mockRejectedValueOnce(new Error('Synthetic store outage'));
    await expect(service.claim(req, slot, 'synthetic-writer-a')).rejects.toThrow('Synthetic store outage');
    expect(store.puts).toEqual([]);
    const held = await hold('synthetic-writer-a');
    store.read.mockRejectedValueOnce(new Error('Synthetic store outage'));
    await expect(service.release(req, held)).resolves.toBeUndefined();
    expect(logger.warning).toHaveBeenCalledWith(req, 'mktg_run_slot_release', expect.stringContaining('could not be released'), {
      ...scope,
      err: expect.any(Error),
    });
    // The reservation is still held: only its deadline frees the slot.
    expect(saved()).toEqual(held);
  });
});
