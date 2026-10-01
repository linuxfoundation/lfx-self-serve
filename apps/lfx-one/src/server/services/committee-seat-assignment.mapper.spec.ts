// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PUBLIC_PROJECT_NAME_CACHE_TTL_MS } from '@lfx-one/shared/constants';
import type { CommitteeServiceOrgSeat, Project } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { logger } = vi.hoisted(() => ({
  logger: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('./logger.service', () => ({ logger }));
vi.mock('./project.service', () => ({ ProjectService: class {} }));
// The shared utils barrel behind the avatar helper pulls Angular into this node-environment suite.
vi.mock('../helpers/avatar.helper', () => ({ resolveSeatAvatar: () => null }));
// A cap of 2 makes the oldest-entry eviction observable with three projects, and the direct-read
// cap observable with three projects missing from the index.
vi.mock('@lfx-one/shared/constants', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  PUBLIC_PROJECT_NAME_CACHE_MAX_ENTRIES: 2,
  PROJECT_VISIBILITY_DIRECT_READ_CAP: 2,
}));

import { enrichFoundationNames, resetPublicProjectNameCacheForTests } from './committee-seat-assignment.mapper';
import type { ProjectService } from './project.service';

const req = {} as Request;

const seat = (projectUid: string): CommitteeServiceOrgSeat => ({ project_uid: projectUid }) as CommitteeServiceOrgSeat;

const project = (uid: string, isPublic: boolean): Project => ({ uid, name: `Name ${uid}`, public: isPublic }) as Project;

describe('enrichFoundationNames — public project name cache', () => {
  const getProjectsByIds = vi.fn();
  const getProjectById = vi.fn();
  const projectService = { getProjectsByIds, getProjectById } as unknown as ProjectService;

  /** Resolves every requested uid from `catalog`, the way query-service answers a batch. */
  function serve(catalog: Project[]): void {
    getProjectsByIds.mockImplementation(async (_req: Request, uids: string[]) => new Map(catalog.filter((p) => uids.includes(p.uid)).map((p) => [p.uid, p])));
  }

  beforeEach(() => {
    getProjectsByIds.mockReset();
    getProjectById.mockReset();
    logger.warning.mockReset();
    resetPublicProjectNameCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves a repeat lookup of public projects without an upstream call', async () => {
    serve([project('pub-a', true), project('pub-b', true)]);

    const first = await enrichFoundationNames(req, [seat('pub-a'), seat('pub-b')], projectService);
    const second = await enrichFoundationNames(req, [seat('pub-b'), seat('pub-a')], projectService);

    expect(getProjectsByIds).toHaveBeenCalledOnce();
    expect(first).toEqual({
      names: new Map([
        ['pub-a', 'Name pub-a'],
        ['pub-b', 'Name pub-b'],
      ]),
      publicUids: new Set(['pub-a', 'pub-b']),
      cachedHits: 0,
      requested: 2,
      resolved: 2,
      privateUids: new Set(),
      confirmedByDirectRead: 0,
    });
    expect(second).toEqual({
      names: first.names,
      publicUids: first.publicUids,
      cachedHits: 2,
      requested: 0,
      resolved: 0,
      privateUids: new Set(),
      confirmedByDirectRead: 0,
    });
  });

  it('never caches a private project name, so every lookup re-fetches it with the caller token', async () => {
    serve([project('priv', false)]);

    const first = await enrichFoundationNames(req, [seat('priv')], projectService);
    getProjectsByIds.mockResolvedValue(new Map());
    const second = await enrichFoundationNames(req, [seat('priv')], projectService);

    expect(first.names.get('priv')).toBe('Name priv');
    expect(first.publicUids.has('priv')).toBe(false);
    expect(getProjectsByIds).toHaveBeenCalledTimes(2);
    expect(getProjectsByIds).toHaveBeenLastCalledWith(req, ['priv']);
    // The lookup answered but returned nothing: asked for 1, resolved 0.
    expect(second).toEqual({
      names: new Map(),
      publicUids: new Set(),
      privateUids: new Set(),
      cachedHits: 0,
      requested: 1,
      resolved: 0,
      confirmedByDirectRead: 0,
    });
  });

  it('re-fetches a public name once the TTL has elapsed', async () => {
    vi.useFakeTimers();
    serve([project('pub-a', true)]);

    await enrichFoundationNames(req, [seat('pub-a')], projectService);
    vi.advanceTimersByTime(PUBLIC_PROJECT_NAME_CACHE_TTL_MS - 1);
    await enrichFoundationNames(req, [seat('pub-a')], projectService);
    expect(getProjectsByIds).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(1);
    const expired = await enrichFoundationNames(req, [seat('pub-a')], projectService);

    expect(getProjectsByIds).toHaveBeenCalledTimes(2);
    expect(expired).toEqual({
      names: new Map([['pub-a', 'Name pub-a']]),
      publicUids: new Set(['pub-a']),
      cachedHits: 0,
      requested: 1,
      resolved: 1,
      privateUids: new Set(),
      confirmedByDirectRead: 0,
    });
  });

  it('serves a project that turned private from cache only until the TTL, then fetches it per request', async () => {
    vi.useFakeTimers();
    serve([project('flip', true)]);
    await enrichFoundationNames(req, [seat('flip')], projectService);

    serve([project('flip', false)]);
    vi.advanceTimersByTime(PUBLIC_PROJECT_NAME_CACHE_TTL_MS - 1);
    const withinTtl = await enrichFoundationNames(req, [seat('flip')], projectService);
    expect(withinTtl.cachedHits).toBe(1);
    expect(getProjectsByIds).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(1);
    const afterTtl = await enrichFoundationNames(req, [seat('flip')], projectService);
    const next = await enrichFoundationNames(req, [seat('flip')], projectService);

    // Once private, the name comes from the caller's own lookup each time and is never re-cached.
    expect(afterTtl).toEqual({
      names: new Map([['flip', 'Name flip']]),
      publicUids: new Set(),
      cachedHits: 0,
      requested: 1,
      resolved: 1,
      privateUids: new Set(['flip']),
      confirmedByDirectRead: 0,
    });
    expect(next.cachedHits).toBe(0);
    expect(getProjectsByIds).toHaveBeenCalledTimes(3);
  });

  it('fetches only the uids missing from the cache when cached and uncached ones are mixed', async () => {
    serve([project('pub-a', true), project('pub-b', true), project('priv', false)]);
    await enrichFoundationNames(req, [seat('pub-a')], projectService);

    const mixed = await enrichFoundationNames(req, [seat('pub-a'), seat('pub-b'), seat('priv'), seat('pub-a')], projectService);

    expect(getProjectsByIds).toHaveBeenLastCalledWith(req, ['pub-b', 'priv']);
    expect(mixed).toEqual({
      names: new Map([
        ['pub-a', 'Name pub-a'],
        ['pub-b', 'Name pub-b'],
        ['priv', 'Name priv'],
      ]),
      publicUids: new Set(['pub-a', 'pub-b']),
      cachedHits: 1,
      requested: 2,
      resolved: 2,
      privateUids: new Set(['priv']),
      confirmedByDirectRead: 0,
    });
  });

  it('marks a public project without a name as public, and a project the lookup did not return as unknown', async () => {
    serve([{ uid: 'pub-unnamed', name: '', public: true } as Project, project('priv', false)]);

    const result = await enrichFoundationNames(req, [seat('pub-unnamed'), seat('priv'), seat('absent')], projectService);

    expect(result.names).toEqual(new Map([['priv', 'Name priv']]));
    expect(result.publicUids).toEqual(new Set(['pub-unnamed']));
    expect(result.privateUids).toEqual(new Set(['priv']));
    // Without `freshVisibility` (Board, Committee, reassign) a project missing from the index costs no extra read.
    expect(getProjectById).not.toHaveBeenCalled();
  });

  it('evicts the oldest public name once the cap is reached', async () => {
    serve([project('pub-1', true), project('pub-2', true), project('pub-3', true)]);
    await enrichFoundationNames(req, [seat('pub-1')], projectService);
    await enrichFoundationNames(req, [seat('pub-2')], projectService);
    await enrichFoundationNames(req, [seat('pub-3')], projectService);

    const afterCap = await enrichFoundationNames(req, [seat('pub-2'), seat('pub-3'), seat('pub-1')], projectService);

    expect(getProjectsByIds).toHaveBeenLastCalledWith(req, ['pub-1']);
    expect(afterCap.cachedHits).toBe(2);
    expect(afterCap.requested).toBe(1);
  });

  // The production outage path: `getProjectsByIds` swallows each failed batch and resolves an empty
  // Map, so the outage is visible only as `resolved` far below `requested`.
  it('keeps cached names and falls back to the slug for the rest when query-service is down', async () => {
    serve([project('pub-a', true)]);
    await enrichFoundationNames(req, [seat('pub-a')], projectService);
    getProjectsByIds.mockResolvedValue(new Map());

    const result = await enrichFoundationNames(req, [seat('pub-a'), seat('pub-b'), seat('pub-c')], projectService);

    expect(result).toEqual({
      names: new Map([['pub-a', 'Name pub-a']]),
      publicUids: new Set(['pub-a']),
      cachedHits: 1,
      requested: 2,
      resolved: 0,
      privateUids: new Set(),
      confirmedByDirectRead: 0,
    });
  });

  it('stays fail-soft when the project lookup itself rejects', async () => {
    serve([project('pub-a', true)]);
    await enrichFoundationNames(req, [seat('pub-a')], projectService);
    getProjectsByIds.mockRejectedValue(new Error('unexpected'));

    const result = await enrichFoundationNames(req, [seat('pub-a'), seat('pub-b')], projectService);

    expect(result).toEqual({
      names: new Map([['pub-a', 'Name pub-a']]),
      publicUids: new Set(['pub-a']),
      cachedHits: 1,
      requested: 1,
      resolved: 0,
      privateUids: new Set(),
      confirmedByDirectRead: 0,
    });
    expect(logger.warning).toHaveBeenCalledOnce();
  });

  describe('with freshVisibility (shared Groups fill)', () => {
    const fresh = { freshVisibility: true };

    it('confirms visibility with its own lookup, not a cached public entry', async () => {
      serve([project('flip', true)]);
      await enrichFoundationNames(req, [seat('flip')], projectService);
      serve([project('flip', false)]);

      const result = await enrichFoundationNames(req, [seat('flip')], projectService, fresh);

      expect(getProjectsByIds).toHaveBeenLastCalledWith(req, ['flip']);
      expect(result.cachedHits).toBe(0);
      expect(result.publicUids).toEqual(new Set());
      // Still readable by this caller, just not confirmed public.
      expect(result.names.get('flip')).toBe('Name flip');
    });

    it('confirms a project missing from the index by a direct read only when it is public', async () => {
      serve([project('indexed', true)]);
      getProjectById.mockImplementation(async (_req: Request, uid: string) => {
        if (uid === 'forbidden') throw new Error('403 Forbidden');
        return project(uid, uid === 'pub-direct');
      });

      const result = await enrichFoundationNames(req, [seat('indexed'), seat('pub-direct'), seat('priv-direct')], projectService, fresh);

      expect(getProjectById.mock.calls.map(([, uid, access]) => [uid, access])).toEqual([
        ['pub-direct', false],
        ['priv-direct', false],
      ]);
      expect(result.publicUids).toEqual(new Set(['indexed', 'pub-direct']));
      expect(result.names.get('pub-direct')).toBe('Name pub-direct');
      expect(result.privateUids).toEqual(new Set(['priv-direct']));
      expect(result.confirmedByDirectRead).toBe(1);

      const forbidden = await enrichFoundationNames(req, [seat('forbidden')], projectService, fresh);
      expect(forbidden.publicUids).toEqual(new Set());
      expect(forbidden.confirmedByDirectRead).toBe(0);
      expect(forbidden.privateUids).toEqual(new Set());
    });

    it('caps the direct reads and logs when the cap is hit', async () => {
      serve([project('indexed', true)]);
      getProjectById.mockImplementation(async (_req: Request, uid: string) => project(uid, true));

      const result = await enrichFoundationNames(req, [seat('indexed'), seat('m-1'), seat('m-2'), seat('m-3')], projectService, fresh);

      expect(getProjectById).toHaveBeenCalledTimes(2);
      expect(result.publicUids).toEqual(new Set(['indexed', 'm-1', 'm-2']));
      expect(result.privateUids).toEqual(new Set());
      expect(result.confirmedByDirectRead).toBe(2);
      expect(logger.warning).toHaveBeenCalledWith(req, 'enrich_foundation_names', expect.any(String), {
        missing_from_project_index: 3,
        direct_read_cap: 2,
      });
    });

    it('skips direct reads when the index returns nothing for several projects (likely outage)', async () => {
      serve([]);
      getProjectById.mockImplementation(async (_req: Request, uid: string) => project(uid, true));

      const result = await enrichFoundationNames(req, [seat('o-1'), seat('o-2')], projectService, fresh);

      expect(getProjectById).not.toHaveBeenCalled();
      expect(result.publicUids).toEqual(new Set());
      expect(result.names.size).toBe(0);
      expect(logger.warning).toHaveBeenCalledWith(req, 'enrich_foundation_names', expect.any(String), { uid_count: 2 });
    });

    it('still reads a single project the index did not return', async () => {
      serve([]);
      getProjectById.mockImplementation(async (_req: Request, uid: string) => project(uid, true));

      const result = await enrichFoundationNames(req, [seat('solo')], projectService, fresh);

      expect(getProjectById).toHaveBeenCalledTimes(1);
      expect(result.publicUids).toEqual(new Set(['solo']));
      expect(result.confirmedByDirectRead).toBe(1);
    });
  });
});
