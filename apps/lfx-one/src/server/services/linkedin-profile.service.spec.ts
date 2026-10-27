// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import { Request } from 'express';
import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { linkedinProfileFromSetup, renderLinkedinProfileMarkdown } from '@lfx-one/shared/utils';
import { ObjectStorePutInput } from '@lfx-one/shared/interfaces';
const warning = vi.hoisted(() => vi.fn());
vi.mock('./logger.service', () => ({ logger: { warning } }));
const objects = vi.hoisted(() => new Map<string, { body: string; metadata: Record<string, string> }>());
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public async getPrivateObject(_req: Request, _purpose: string, key: string) {
      return objects.get(key) ?? null;
    }
    public async putMutableObject(_req: Request, _purpose: string, key: string, input: ObjectStorePutInput) {
      objects.set(key, { body: Buffer.from(input.body).toString('utf8'), metadata: input.metadata ?? {} });
    }
    public async putPrivateObjectIfAbsent(_req: Request, _purpose: string, key: string, input: ObjectStorePutInput) {
      if (objects.has(key)) return false;
      objects.set(key, { body: Buffer.from(input.body).toString('utf8'), metadata: input.metadata ?? {} });
      return true;
    }
    public async deletePrivateObject(_req: Request, _purpose: string, key: string) {
      objects.delete(key);
    }
  },
}));
import { LinkedinProfileService } from './linkedin-profile.service';
import { ObjectStoreService } from './object-store.service';

const req = {} as Request;
const setup = { name: 'Example author', role: 'Maintainer', focus_areas: 'Code', primary_audience: 'Developers' };
describe('LinkedIn per-user profile store', () => {
  beforeEach(() => {
    objects.clear();
    warning.mockClear();
    vi.stubEnv('PCC_AUTH0_SECRET', 'synthetic-profile-secret');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  it('round-trips both formats at a service-keyed HMAC path, isolated from other subjects', async () => {
    const store = new LinkedinProfileService();
    const profile = linkedinProfileFromSetup(setup);
    const saved = { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) };
    expect(await store.read(req, 'subject-one')).toBeNull();
    await store.save(req, 'subject-one', saved);
    expect(await store.read(req, 'subject-one')).toEqual(saved);
    expect(await store.read(req, 'subject-two')).toBeNull();
    const id = createHmac('sha256', 'synthetic-profile-secret').update('linkedin-profile:subject-one').digest('hex');
    expect([...objects.keys()]).toEqual([`user-profiles/linkedin-post/${id}/current.json`]);
    expect([...objects.keys()][0]).not.toContain(createHash('sha256').update('subject-one').digest('hex'));
  });
  it('converts setup in the service and replaces the current application record', async () => {
    const store = new LinkedinProfileService();
    await store.saveFromInput(req, 'subject-one', { setup });
    const changed = { ...setup, name: 'Replacement author', tone: 'direct' };
    const saved = await store.saveFromInput(req, 'subject-one', { setup: changed });
    expect(objects.size).toBe(1);
    expect(await store.read(req, 'subject-one')).toEqual(saved);
    expect([...objects.values()][0].body).not.toContain('Example author');
  });
  it('round-trips whitespace projects as None', async () => {
    const store = new LinkedinProfileService();
    await store.saveFromInput(req, 'subject-one', { setup: { ...setup, associated_projects: '   ' } });
    expect((await store.read(req, 'subject-one'))?.profile.about.associated_projects).toBe('None');
  });
  it('initializes create-only without overwriting an edit that wins after the initialization claim', async () => {
    const store = new LinkedinProfileService();
    const put = ObjectStoreService.prototype.putPrivateObjectIfAbsent;
    vi.spyOn(ObjectStoreService.prototype, 'putPrivateObjectIfAbsent').mockImplementation(async function (this: ObjectStoreService, req, purpose, key, input) {
      if (key.endsWith('current.json')) await store.saveFromInput(req, 'subject-one', { setup: { ...setup, role: 'Updated role' } });
      return put.call(this, req, purpose, key, input);
    });
    const profile = linkedinProfileFromSetup(setup);
    expect(await store.initializeOnce(req, 'subject-one', 'synthetic-session', { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) })).toBe(
      true
    );
    expect((await store.read(req, 'subject-one'))?.profile.about.role).toBe('Updated role');
  });
  it('retries an incomplete profile write after restart but never replays completed setup after delete', async () => {
    const store = new LinkedinProfileService();
    const profile = linkedinProfileFromSetup(setup);
    const saved = { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) };
    const put = ObjectStoreService.prototype.putPrivateObjectIfAbsent;
    const failure = new Error('Synthetic profile write failure');
    let failed = false;
    vi.spyOn(ObjectStoreService.prototype, 'putPrivateObjectIfAbsent').mockImplementation(async function (this: ObjectStoreService, req, purpose, key, input) {
      if (key.endsWith('current.json') && !failed) {
        failed = true;
        throw failure;
      }
      return put.call(this, req, purpose, key, input);
    });
    await expect(store.initializeOnce(req, 'subject-one', 'synthetic-session', saved)).rejects.toBe(failure);
    expect(objects.size).toBe(0);
    expect(await new LinkedinProfileService().initializeOnce(req, 'subject-one', 'synthetic-session', saved)).toBe(true);
    await store.delete(req, 'subject-one');
    expect(await new LinkedinProfileService().initializeOnce(req, 'subject-one', 'synthetic-session', saved)).toBe(false);
    expect(await store.read(req, 'subject-one')).toBeNull();
  });
  it('preserves the original write failure if claim cleanup also fails without logging private details', async () => {
    const failure = new Error('Synthetic profile write failure');
    const put = ObjectStoreService.prototype.putPrivateObjectIfAbsent;
    vi.spyOn(ObjectStoreService.prototype, 'putPrivateObjectIfAbsent').mockImplementation(async function (this: ObjectStoreService, req, purpose, key, input) {
      if (key.endsWith('current.json')) throw failure;
      return put.call(this, req, purpose, key, input);
    });
    vi.spyOn(ObjectStoreService.prototype, 'deletePrivateObject').mockRejectedValue(new Error('PRIVATE_CLEANUP_MARKER'));
    const profile = linkedinProfileFromSetup(setup);
    await expect(
      new LinkedinProfileService().initializeOnce(req, 'subject-one', 'synthetic-session', {
        profile,
        profile_markdown: renderLinkedinProfileMarkdown(profile),
      })
    ).rejects.toBe(failure);
    expect(warning).toHaveBeenCalledWith(req, 'linkedin_profile_initialize', expect.any(String), {});
    expect(JSON.stringify(warning.mock.calls)).not.toContain('PRIVATE_CLEANUP_MARKER');
  });
  it('retains a non-personal consumed marker across deletion and service restart, never recreating the profile', async () => {
    const store = new LinkedinProfileService();
    const profile = linkedinProfileFromSetup(setup);
    const saved = { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) };
    expect(await store.initializeOnce(req, 'subject-one', 'synthetic-session', saved)).toBe(true);
    await store.delete(req, 'subject-one');
    expect(await new LinkedinProfileService().initializeOnce(req, 'subject-one', 'synthetic-session', saved)).toBe(false);
    expect(await store.read(req, 'subject-one')).toBeNull();
    expect([...objects.values()]).toEqual([{ body: '{}', metadata: {} }]);
    expect([...objects.keys()][0]).not.toContain('synthetic-session');
  });
  it('documents an admitted first run finishing after an intervening delete, not a deletion fence', async () => {
    const store = new LinkedinProfileService();
    const profile = linkedinProfileFromSetup(setup);
    const saved = { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) };
    const put = ObjectStoreService.prototype.putPrivateObjectIfAbsent;
    let started: (() => void) | undefined;
    let release: (() => void) | undefined;
    const paused = new Promise<void>((resolve) => {
      started = resolve;
    });
    const resumed = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(ObjectStoreService.prototype, 'putPrivateObjectIfAbsent').mockImplementation(async function (this: ObjectStoreService, req, purpose, key, input) {
      if (key.endsWith('current.json')) {
        started?.();
        await resumed;
      }
      return put.call(this, req, purpose, key, input);
    });
    const initializing = store.initializeOnce(req, 'subject-one', 'synthetic-session', saved);
    try {
      await paused;
      await new LinkedinProfileService().delete(req, 'subject-one');
      expect(await store.read(req, 'subject-one')).toBeNull();
    } finally {
      release?.();
      await initializing;
    }
    expect(await store.read(req, 'subject-one')).toEqual(saved);
    await store.delete(req, 'subject-one');
    expect(await store.initializeOnce(req, 'subject-one', 'synthetic-session', saved)).toBe(false);
  });
  it('deletes only the requesting subject’s current record, idempotently', async () => {
    const store = new LinkedinProfileService();
    await store.saveFromInput(req, 'subject-one', { setup });
    await store.saveFromInput(req, 'subject-two', { setup });
    await store.delete(req, 'subject-one');
    expect(await store.read(req, 'subject-one')).toBeNull();
    expect(await store.read(req, 'subject-two')).not.toBeNull();
    expect(objects.size).toBe(1);
    await store.delete(req, 'subject-one');
  });
  it('reports corruption and invalid JSON through classified storage errors, never first-run absence', async () => {
    const store = new LinkedinProfileService();
    await store.saveFromInput(req, 'subject-one', { setup });
    const key = [...objects.keys()][0];
    const saved = objects.get(key);
    if (!saved) throw new Error('Expected saved synthetic profile');
    objects.set(key, { ...saved, body: '{}' });
    await expect(store.read(req, 'subject-one')).rejects.toMatchObject({ code: 'LINKEDIN_PROFILE_HASH_MISMATCH', service: 'object_store' });
    objects.set(key, { body: '{', metadata: { 'content-sha256': createHash('sha256').update('{').digest('hex') } });
    await expect(store.read(req, 'subject-one')).rejects.toMatchObject({ code: 'LINKEDIN_PROFILE_READ_FAILED' });
    objects.set(key, { body: '{}', metadata: { 'content-sha256': createHash('sha256').update('{}').digest('hex') } });
    await expect(store.read(req, 'subject-one')).rejects.toMatchObject({ code: 'LINKEDIN_PROFILE_INVALID' });
  });
  it('saves without invoking any deletion, enumeration or version operations', async () => {
    const deletion = vi.spyOn(ObjectStoreService.prototype, 'deletePrivateObject').mockRejectedValue(new Error('Synthetic deletion denial'));
    const write = vi.spyOn(ObjectStoreService.prototype, 'putMutableObject');
    const saved = await new LinkedinProfileService().saveFromInput(req, 'subject-one', { setup });
    expect(write).toHaveBeenCalledOnce();
    expect(deletion).not.toHaveBeenCalled();
    expect(saved.profile.about.name).toBe(setup.name);
    expect(objects.size).toBe(1);
  });
  it('re-renders valid stored profiles after agent Markdown format drift without weakening byte integrity', async () => {
    const store = new LinkedinProfileService();
    const profile = linkedinProfileFromSetup(setup);
    await store.save(req, 'subject-one', { profile, profile_markdown: '# Older agent format\nName = Example author\n' });
    expect(await store.read(req, 'subject-one')).toEqual({ profile, profile_markdown: renderLinkedinProfileMarkdown(profile) });
    const key = [...objects.keys()][0];
    const saved = objects.get(key);
    if (!saved) throw new Error('Expected saved synthetic profile');
    objects.set(key, { ...saved, body: saved.body + ' ' });
    await expect(store.read(req, 'subject-one')).rejects.toMatchObject({ code: 'LINKEDIN_PROFILE_HASH_MISMATCH' });
  });
  it('fails closed without a server secret rather than using a guessable default key', async () => {
    vi.stubEnv('PCC_AUTH0_SECRET', '');
    await expect(new LinkedinProfileService().read(req, 'subject-one')).rejects.toMatchObject({ code: 'LINKEDIN_PROFILE_KEY_UNAVAILABLE' });
  });
});
