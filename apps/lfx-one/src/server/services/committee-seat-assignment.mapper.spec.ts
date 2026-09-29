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

import { enrichFoundationNames, resetPublicProjectNameCacheForTests } from './committee-seat-assignment.mapper';
import type { ProjectService } from './project.service';

const req = {} as unknown as Request;

const seat = (projectUid: string): CommitteeServiceOrgSeat => ({ project_uid: projectUid }) as CommitteeServiceOrgSeat;

const project = (uid: string, isPublic: boolean): Project => ({ uid, name: `Name ${uid}`, public: isPublic }) as Project;

describe('enrichFoundationNames — public project name cache', () => {
  const getProjectsByIds = vi.fn();
  const projectService = { getProjectsByIds } as unknown as ProjectService;

  /** Resolves every requested uid from `catalog`, the way query-service answers a batch. */
  function serve(catalog: Project[]): void {
    getProjectsByIds.mockImplementation(async (_req: Request, uids: string[]) => new Map(catalog.filter((p) => uids.includes(p.uid)).map((p) => [p.uid, p])));
  }

  beforeEach(() => {
    getProjectsByIds.mockReset();
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
      cachedHits: 0,
      fetched: 2,
    });
    expect(second.names).toEqual(first.names);
    expect(second.cachedHits).toBe(2);
    expect(second.fetched).toBe(0);
  });

  it('never caches a private project name, so every lookup re-fetches it with the caller token', async () => {
    serve([project('priv', false)]);

    const first = await enrichFoundationNames(req, [seat('priv')], projectService);
    getProjectsByIds.mockResolvedValue(new Map());
    const second = await enrichFoundationNames(req, [seat('priv')], projectService);

    expect(first.names.get('priv')).toBe('Name priv');
    expect(getProjectsByIds).toHaveBeenCalledTimes(2);
    expect(getProjectsByIds).toHaveBeenLastCalledWith(req, ['priv']);
    expect(second).toEqual({ names: new Map(), cachedHits: 0, fetched: 1 });
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
    expect(expired.cachedHits).toBe(0);
    expect(expired.names.get('pub-a')).toBe('Name pub-a');
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
      cachedHits: 1,
      fetched: 2,
    });
  });

  it('keeps cached names and falls back to the slug for the rest when the fetch fails', async () => {
    serve([project('pub-a', true)]);
    await enrichFoundationNames(req, [seat('pub-a')], projectService);
    getProjectsByIds.mockRejectedValue(new Error('query-service down'));

    const result = await enrichFoundationNames(req, [seat('pub-a'), seat('pub-b')], projectService);

    expect(result).toEqual({ names: new Map([['pub-a', 'Name pub-a']]), cachedHits: 1, fetched: 1 });
    expect(logger.warning).toHaveBeenCalledOnce();
  });
});
