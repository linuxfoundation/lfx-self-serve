// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CommitteeServiceOrgSeat, FoundationNameEnrichment, OrgLensGroupsResponse, Project } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors org-people-directory.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into
// this app's vitest config, so runtime collaborators are mocked. `OrgLensBoardCommitteeService`,
// `ProjectService`, and `CommitteeService` are constructed in `OrgLensGroupsService`'s
// constructor, so they must be mocked at module level; `enrichFoundationNames` and
// `getCommitteesByIds` are mocked directly so tests can control each enrichment source
// independently without exercising the real query-service calls underneath. The fresh-visibility
// tests swap the real `enrichFoundationNames` back in and drive it through the project lookups.
const { fetchAllOrgSeatsUncached, enrichFoundationNames, getCommitteesByIds, getProjectsByIds, getProjectById, cacheWrites } = vi.hoisted(() => ({
  fetchAllOrgSeatsUncached: vi.fn(),
  enrichFoundationNames: vi.fn(),
  getCommitteesByIds: vi.fn(),
  getProjectsByIds: vi.fn(),
  getProjectById: vi.fn(),
  cacheWrites: [] as unknown[],
}));

// Deliberately exposes only the uncached drain: this aggregate is retained for far longer than the
// per-caller seats cache, so reading through that cache would bake a just-reassigned seat into the
// stored aggregate for the full window. Switching back to the cached drain fails here rather than
// silently.
vi.mock('./org-lens-board-committee.service', () => ({
  OrgLensBoardCommitteeService: class {
    public fetchAllOrgSeatsUncached = fetchAllOrgSeatsUncached;
  },
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectsByIds = getProjectsByIds;
    public getProjectById = getProjectById;
  },
}));
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public getCommitteesByIds = getCommitteesByIds;
  },
}));
vi.mock('./committee-seat-assignment.mapper', () => ({
  enrichFoundationNames,
}));
vi.mock('./logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// The shared utils barrel behind the real mapper's avatar helper pulls Angular into this suite.
vi.mock('../helpers/avatar.helper', () => ({ resolveSeatAvatar: () => null }));

// The `@lfx-one/shared/*` barrels pull Angular into this node-environment suite, so the handful
// of runtime values the service imports are stubbed here. `isBoardCategory` mirrors the real
// implementation, since the non-board filter's behaviour depends on it.
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', () => ({
  isBoardCategory: (category: string | null | undefined) => (category ?? '').trim().toLowerCase() === 'board',
  VALKEY_CACHE: { ORG_LENS_GROUPS_TTL_SECONDS: 900 },
  PUBLIC_PROJECT_NAME_CACHE_TTL_MS: 5 * 60 * 1000,
  PUBLIC_PROJECT_NAME_CACHE_MAX_ENTRIES: 5000,
  PROJECT_VISIBILITY_DIRECT_READ_CAP: 20,
}));

// The cache layer pulls in the Valkey client, which this node suite has no business starting.
// `withOrgGroupsCache` is stubbed as a permanent cache miss that records what its fetcher would
// store in `cacheWrites`, so these tests exercise the aggregation logic and can inspect exactly
// what is shared across callers.
vi.mock('./valkey.service', () => ({
  buildOrgGroupsCacheKey: (orgUid: string) => `test:org-lens-groups:v3:${orgUid}`,
  withOrgGroupsCache: async (_orgUid: string, _ttl: number, fetcher: () => Promise<unknown>) => {
    const value = await fetcher();
    cacheWrites.push(value);
    return value;
  },
}));

import type { Request } from 'express';

import type * as NameEnrichment from './committee-seat-assignment.mapper';
import { logger } from './logger.service';
import { OrgLensGroupsService } from './org-lens-groups.service';
import type { ProjectService } from './project.service';

const ORG_UID = 'org-1';
const req = {} as unknown as Request;

function seat(over: Partial<CommitteeServiceOrgSeat> = {}): CommitteeServiceOrgSeat {
  return {
    uid: 'seat-1',
    committee_uid: 'c-1',
    committee_name: 'WG Identity & Trust',
    committee_category: 'Working Group',
    email: 'dclarke@contractor.lfx-partner.example',
    project_uid: 'p-cncf',
    project_slug: 'cncf',
    ...over,
  } as CommitteeServiceOrgSeat;
}

async function run(): Promise<OrgLensGroupsResponse> {
  // `org-grant` is the shared-cache path; a team-entitled (auditor-entitlement) caller would bypass the cache entirely.
  return new OrgLensGroupsService().getGroups(req, ORG_UID, 'org-grant');
}

/**
 * An `enrichFoundationNames` result from one project lookup. Every named uid is public unless
 * `publicUids` says otherwise; a uid in `publicUids` without a name is public but unnamed. Named uids
 * that are not public are private unless `privateUids` says otherwise; any other uid is unknown.
 */
function foundationNames(
  names: [string, string][] = [],
  publicUids: string[] = names.map(([uid]) => uid),
  privateUids: string[] = names.map(([uid]) => uid).filter((uid) => !publicUids.includes(uid))
): FoundationNameEnrichment {
  return {
    names: new Map(names),
    publicUids: new Set(publicUids),
    privateUids: new Set(privateUids),
    cachedHits: 0,
    requested: 1,
    resolved: names.length,
    confirmedByDirectRead: 0,
  };
}

/** The one aggregate this run wrote to the org-shared cache. */
function writtenAggregate(): OrgLensGroupsResponse {
  expect(cacheWrites).toHaveLength(1);
  return cacheWrites[0] as OrgLensGroupsResponse;
}

/** Answers the committee index for every uid it is given, the way a caller who can see each committee's project would. */
function committeeIndexAnswers(projectNameByCommittee: Record<string, string>): void {
  getCommitteesByIds.mockImplementation((_req: unknown, uids: string[]) =>
    Promise.resolve(new Map(uids.filter((uid) => projectNameByCommittee[uid]).map((uid) => [uid, { uid, project_name: projectNameByCommittee[uid] }])))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  cacheWrites.length = 0;
  // Default both enrichment sources to "no match" so each test only sets up the source it's
  // actually exercising.
  enrichFoundationNames.mockResolvedValue(foundationNames());
  getCommitteesByIds.mockResolvedValue(new Map());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OrgLensGroupsService.getGroups', () => {
  it('uses the live project-index name and never asks the committee index about that group', async () => {
    fetchAllOrgSeatsUncached.mockResolvedValue([seat()]);
    // Argument-respecting, not a blanket resolved-value: only returns data for uids it was
    // actually asked about, so this test can't pass by the mock supplying data the real
    // targeting logic (org-lens-groups.service.ts) would never have requested in the first
    // place. Precedence between the two sources isn't decided by the `||` in toGroupSummary —
    // it's enforced structurally by unresolvedCommitteeUids: a uid the project index resolves is
    // never passed to the committee index, so the two can never compete for the same group. That
    // targeting is what this test (and the "skips the fan-out" test below) actually pin.
    getCommitteesByIds.mockImplementation((_req: unknown, uids: string[]) =>
      Promise.resolve(new Map(uids.map((uid) => [uid, { uid, project_name: 'Cloud Native Computing Foundation (stale)' }])))
    );
    enrichFoundationNames.mockResolvedValue(foundationNames([['p-cncf', 'Cloud Native Computing Foundation']]));

    const result = await run();

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].project_name).toBe('Cloud Native Computing Foundation');
    expect(result.groups[0].project_slug).toBe('cncf');
  });

  it('skips the committee-index fan-out entirely when the project index already resolved every group', async () => {
    fetchAllOrgSeatsUncached.mockResolvedValue([seat()]);
    enrichFoundationNames.mockResolvedValue(foundationNames([['p-cncf', 'Cloud Native Computing Foundation']]));

    await run();

    // The committee index is a gap-filler, not a second full fan-out — on the common path where
    // the project index resolves everything, calling it with an empty array short-circuits to no
    // upstream request at all (CommitteeService.getCommitteesByIds returns early on []).
    expect(getCommitteesByIds).toHaveBeenCalledWith(req, []);
    // No gaps to report — the enrichment INFO log is gated on there being something to log. Asserted
    // against that event specifically, since every request also emits an `org_lens_groups_request`
    // INFO line carrying the cold/warm result source.
    expect(logger.info).not.toHaveBeenCalledWith(req, 'org_lens_groups_enrich', expect.any(String), expect.anything());
  });

  it('falls back to the committee-index name for a public project the project index returned without a name', async () => {
    fetchAllOrgSeatsUncached.mockResolvedValue([seat()]);
    getCommitteesByIds.mockResolvedValue(new Map([['c-1', { uid: 'c-1', project_name: 'Cloud Native Computing Foundation (committee index)' }]]));
    enrichFoundationNames.mockResolvedValue(foundationNames([], ['p-cncf']));

    const result = await run();

    expect(result.groups[0].project_name).toBe('Cloud Native Computing Foundation (committee index)');
    // Only the unresolved committee is passed through — the gap-filler is targeted, not blanket.
    expect(getCommitteesByIds).toHaveBeenCalledWith(req, ['c-1']);
    // The corrected metric: 1 gap, resolved by the committee index, 0 left unresolved.
    expect(logger.info).toHaveBeenCalledWith(req, 'org_lens_groups_enrich', expect.any(String), {
      total_committees: 1,
      gaps_from_project_index: 1,
      resolved_from_committee_index: 1,
      unresolved_after_both_sources: 0,
      withheld_private: 0,
      missing_from_project_index: 0,
      missing_from_project_index_uids: [],
      no_project_uid: 0,
      confirmed_by_direct_read: 0,
    });
  });

  it('omits project_name (but keeps project_slug) when both enrichment sources miss', async () => {
    fetchAllOrgSeatsUncached.mockResolvedValue([seat()]);
    enrichFoundationNames.mockResolvedValue(foundationNames([], ['p-cncf']));

    const result = await run();

    expect(result.groups[0].project_name).toBeUndefined();
    expect(result.groups[0].project_slug).toBe('cncf');
    // The gap was real but neither source resolved it — logged as unresolved, not "resolved".
    expect(logger.info).toHaveBeenCalledWith(req, 'org_lens_groups_enrich', expect.any(String), {
      total_committees: 1,
      gaps_from_project_index: 1,
      resolved_from_committee_index: 0,
      unresolved_after_both_sources: 1,
      withheld_private: 0,
      missing_from_project_index: 0,
      missing_from_project_index_uids: [],
      no_project_uid: 0,
      confirmed_by_direct_read: 0,
    });
  });

  it('leaves a group whose seats carry no project_uid unnamed, even when the committee index has a project name', async () => {
    fetchAllOrgSeatsUncached.mockResolvedValue([seat({ project_uid: undefined, project_slug: undefined })]);
    // Blanket answer: with no project there is no visibility to confirm, so this name is never used.
    getCommitteesByIds.mockResolvedValue(new Map([['c-1', { uid: 'c-1', project_name: 'Maybe Private Foundation' }]]));

    const result = await run();

    expect(result.groups[0].project_name).toBeUndefined();
    expect(result.groups[0].project_slug).toBeUndefined();
    expect(getCommitteesByIds).toHaveBeenCalledWith(req, []);
    expect(logger.info).toHaveBeenCalledWith(
      req,
      'org_lens_groups_enrich',
      expect.any(String),
      expect.objectContaining({ no_project_uid: 1, withheld_private: 0 })
    );
  });

  it('still returns groups (falling back to the slug) when the committee-index lookup throws', async () => {
    fetchAllOrgSeatsUncached.mockResolvedValue([seat()]);
    getCommitteesByIds.mockRejectedValue(new Error('query-service unavailable'));
    enrichFoundationNames.mockResolvedValue(foundationNames([], ['p-cncf']));

    const result = await run();

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].project_name).toBeUndefined();
    expect(result.groups[0].project_slug).toBe('cncf');
  });

  it('excludes board committees from the roster', async () => {
    fetchAllOrgSeatsUncached.mockResolvedValue([seat({ committee_category: 'Board' })]);

    const result = await run();

    expect(result.groups).toHaveLength(0);
    expect(result.total_groups).toBe(0);
  });

  describe('shared aggregate carries only public foundation names', () => {
    const privateSeat = seat({ uid: 'seat-2', committee_uid: 'c-priv', committee_name: 'Secret TAG', project_uid: 'p-priv', project_slug: 'secret' });
    const unnamedPrivateSeat = seat({ uid: 'seat-4', committee_uid: 'c-hidden', committee_name: 'Hidden WG', project_uid: 'p-hidden', project_slug: 'hidden' });
    const unnamedPublicSeat = seat({
      uid: 'seat-3',
      committee_uid: 'c-pub-unnamed',
      committee_name: 'Open WG',
      project_uid: 'p-pub-unnamed',
      project_slug: 'pub-unnamed',
    });

    it('keeps a private project name the filler can read out of the cached aggregate, from either source', async () => {
      fetchAllOrgSeatsUncached.mockResolvedValue([seat(), privateSeat, unnamedPrivateSeat]);
      // The filler holds `viewer` on p-priv, so the project index names it — but it is not public.
      // p-hidden is private too, and the project index left it unnamed.
      enrichFoundationNames.mockResolvedValue(
        foundationNames(
          [
            ['p-cncf', 'Cloud Native Computing Foundation'],
            ['p-priv', 'Secret Foundation'],
          ],
          ['p-cncf'],
          ['p-priv', 'p-hidden']
        )
      );
      // Blanket answer: the committee index names both private projects even though it is not
      // asked about either, so only the public gate in toGroupSummary keeps them out.
      getCommitteesByIds.mockResolvedValue(
        new Map([
          ['c-priv', { uid: 'c-priv', project_name: 'Secret Foundation' }],
          ['c-hidden', { uid: 'c-hidden', project_name: 'Hidden Foundation' }],
        ])
      );

      await run();

      const stored = writtenAggregate();
      expect(stored.groups.map((g) => [g.project_slug, g.project_name])).toEqual([
        ['hidden', undefined],
        ['secret', undefined],
        ['cncf', 'Cloud Native Computing Foundation'],
      ]);
      expect(JSON.stringify(stored)).not.toMatch(/Secret Foundation|Hidden Foundation/);
      // A withheld private name is not a gap: the committee index is never asked about it.
      expect(getCommitteesByIds).toHaveBeenCalledWith(req, []);
      expect(logger.info).toHaveBeenCalledWith(
        req,
        'org_lens_groups_enrich',
        expect.any(String),
        expect.objectContaining({ withheld_private: 2, missing_from_project_index: 0 })
      );
    });

    it('drops a private project name the committee index returns, while still filling a public gap from it', async () => {
      fetchAllOrgSeatsUncached.mockResolvedValue([privateSeat, unnamedPublicSeat]);
      // p-pub-unnamed is public but unnamed in the project index; p-priv is invisible to the project lookup.
      enrichFoundationNames.mockResolvedValue(foundationNames([], ['p-pub-unnamed']));
      // Blanket answer: the committee index hands back the private project's name even for a uid
      // it was not asked about, so only the public gate in toGroupSummary keeps it out.
      getCommitteesByIds.mockResolvedValue(
        new Map([
          ['c-priv', { uid: 'c-priv', project_name: 'Secret Foundation' }],
          ['c-pub-unnamed', { uid: 'c-pub-unnamed', project_name: 'Open Foundation' }],
        ])
      );

      await run();

      const stored = writtenAggregate();
      expect(getCommitteesByIds).toHaveBeenCalledWith(req, ['c-pub-unnamed']);
      expect(stored.groups.find((g) => g.uid === 'c-pub-unnamed')?.project_name).toBe('Open Foundation');
      const priv = stored.groups.find((g) => g.uid === 'c-priv');
      expect(priv?.project_name).toBeUndefined();
      expect(priv?.project_slug).toBe('secret');
      expect(JSON.stringify(stored)).not.toContain('Secret Foundation');
    });

    it('names nothing (slug fallback) and leaks nothing private when the project lookup fails', async () => {
      fetchAllOrgSeatsUncached.mockResolvedValue([seat(), privateSeat]);
      // What enrichFoundationNames yields on a query-service outage: no names, no confirmed visibility.
      enrichFoundationNames.mockResolvedValue(foundationNames());
      committeeIndexAnswers({ 'c-1': 'Cloud Native Computing Foundation', 'c-priv': 'Secret Foundation' });

      await run();

      const stored = writtenAggregate();
      expect(stored.groups.map((g) => [g.project_slug, g.project_name])).toEqual([
        ['secret', undefined],
        ['cncf', undefined],
      ]);
      expect(getCommitteesByIds).toHaveBeenCalledWith(req, []);
      // Neither project's visibility is known, so both count as missing and are listed for follow-up.
      expect(logger.info).toHaveBeenCalledWith(
        req,
        'org_lens_groups_enrich',
        expect.any(String),
        expect.objectContaining({ withheld_private: 0, missing_from_project_index: 2, missing_from_project_index_uids: ['p-cncf', 'p-priv'] })
      );
    });

    it('applies the same public-only rule on the uncached auditor-entitlement path', async () => {
      fetchAllOrgSeatsUncached.mockResolvedValue([privateSeat]);
      enrichFoundationNames.mockResolvedValue(foundationNames([['p-priv', 'Secret Foundation']], []));
      committeeIndexAnswers({ 'c-priv': 'Secret Foundation' });

      const result = await new OrgLensGroupsService().getGroups(req, ORG_UID, 'auditor-entitlement');

      expect(cacheWrites).toHaveLength(0);
      expect(result.groups[0].project_name).toBeUndefined();
      expect(result.groups[0].project_slug).toBe('secret');
    });
  });

  describe('fresh visibility with the real name enrichment', () => {
    const missingFromIndexSeat = seat({ uid: 'seat-5', committee_uid: 'c-uepf', committee_name: 'UEC WG', project_uid: 'p-uepf', project_slug: 'uepf' });
    const project = (uid: string, name: string, isPublic: boolean): Project => ({ uid, name, public: isPublic }) as Project;

    /** Answers the project index from `catalog` for the uids it is asked about; anything else is missing from the index. */
    function serveIndex(catalog: Project[]): void {
      getProjectsByIds.mockImplementation(async (_req: Request, uids: string[]) => new Map(catalog.filter((p) => uids.includes(p.uid)).map((p) => [p.uid, p])));
    }

    /** Answers direct project reads from `catalog`; a uid not in it is forbidden to the caller. */
    function serveDirectReads(catalog: Project[]): void {
      getProjectById.mockImplementation(async (_req: Request, uid: string) => {
        const found = catalog.find((p) => p.uid === uid);
        if (!found) throw new Error('403 Forbidden');
        return found;
      });
    }

    let realEnrichment: typeof NameEnrichment;

    beforeEach(async () => {
      realEnrichment = await vi.importActual<typeof NameEnrichment>('./committee-seat-assignment.mapper');
      realEnrichment.resetPublicProjectNameCacheForTests();
      enrichFoundationNames.mockImplementation(realEnrichment.enrichFoundationNames);
      serveIndex([]);
      serveDirectReads([]);
    });

    it('writes no name for a project that turned private after the public-name cache was warmed', async () => {
      fetchAllOrgSeatsUncached.mockResolvedValue([seat()]);
      serveIndex([project('p-cncf', 'Cloud Native Computing Foundation', true)]);
      // A Board/Committee read on this pod caches the name while the project is still public.
      const warm = await realEnrichment.enrichFoundationNames(req, [seat()], { getProjectsByIds } as unknown as ProjectService);
      expect(warm.publicUids.has('p-cncf')).toBe(true);
      // The filler holds `viewer`, so the project index still names the now-private project.
      serveIndex([project('p-cncf', 'Cloud Native Computing Foundation', false)]);

      await run();

      const stored = writtenAggregate();
      expect([stored.groups[0].project_slug, stored.groups[0].project_name]).toEqual(['cncf', undefined]);
      expect(JSON.stringify(stored)).not.toContain('Cloud Native Computing Foundation');
      // The fill asked the project index itself instead of trusting the cache entry.
      expect(getProjectsByIds).toHaveBeenLastCalledWith(req, ['p-cncf']);
      expect(logger.info).toHaveBeenCalledWith(req, 'org_lens_groups_enrich', expect.any(String), expect.objectContaining({ withheld_private: 1 }));
    });

    it('names a public project missing from the project index from the committee index once a direct read confirms it public', async () => {
      fetchAllOrgSeatsUncached.mockResolvedValue([missingFromIndexSeat]);
      serveDirectReads([{ uid: 'p-uepf', public: true } as Project]);
      committeeIndexAnswers({ 'c-uepf': 'Ultra Ethernet Consortium Fund' });

      await run();

      expect(getProjectById).toHaveBeenCalledWith(req, 'p-uepf', false);
      expect(writtenAggregate().groups[0]).toMatchObject({ project_slug: 'uepf', project_name: 'Ultra Ethernet Consortium Fund' });
      expect(logger.info).toHaveBeenCalledWith(req, 'org_lens_groups_enrich', expect.any(String), {
        total_committees: 1,
        gaps_from_project_index: 1,
        resolved_from_committee_index: 1,
        unresolved_after_both_sources: 0,
        withheld_private: 0,
        missing_from_project_index: 0,
        missing_from_project_index_uids: [],
        no_project_uid: 0,
        confirmed_by_direct_read: 1,
      });
    });

    it('prefers the direct-read name over the committee-index snapshot for a project missing from the index', async () => {
      fetchAllOrgSeatsUncached.mockResolvedValue([missingFromIndexSeat]);
      serveDirectReads([project('p-uepf', 'Ultra Ethernet Consortium Fund', true)]);
      committeeIndexAnswers({ 'c-uepf': 'Ultra Ethernet Consortium (stale)' });

      await run();

      expect(writtenAggregate().groups[0].project_name).toBe('Ultra Ethernet Consortium Fund');
      expect(getCommitteesByIds).toHaveBeenCalledWith(req, []);
    });

    it('writes no name for a private or unreadable project missing from the project index', async () => {
      const forbiddenSeat = seat({
        uid: 'seat-6',
        committee_uid: 'c-forbidden',
        committee_name: 'Closed WG',
        project_uid: 'p-forbidden',
        project_slug: 'closed',
      });
      // The index answers for p-cncf, so it is up and the other two are really missing from it.
      fetchAllOrgSeatsUncached.mockResolvedValue([seat(), missingFromIndexSeat, forbiddenSeat]);
      serveIndex([project('p-cncf', 'Cloud Native Computing Foundation', true)]);
      // The filler can read p-uepf directly, but it is private; p-forbidden is not readable at all.
      serveDirectReads([project('p-uepf', 'Secret Foundation', false)]);
      getCommitteesByIds.mockResolvedValue(
        new Map([
          ['c-uepf', { uid: 'c-uepf', project_name: 'Secret Foundation' }],
          ['c-forbidden', { uid: 'c-forbidden', project_name: 'Closed Foundation' }],
        ])
      );

      await run();

      const stored = writtenAggregate();
      expect(stored.groups.filter((g) => g.project_uid !== 'p-cncf').map((g) => [g.project_slug, g.project_name])).toEqual([
        ['closed', undefined],
        ['uepf', undefined],
      ]);
      expect(JSON.stringify(stored)).not.toMatch(/Secret Foundation|Closed Foundation/);
      expect(logger.info).toHaveBeenCalledWith(
        req,
        'org_lens_groups_enrich',
        expect.any(String),
        expect.objectContaining({
          withheld_private: 1,
          missing_from_project_index: 1,
          missing_from_project_index_uids: ['p-forbidden'],
          confirmed_by_direct_read: 0,
        })
      );
    });
  });
});
