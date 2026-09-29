// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CommitteeServiceOrgSeat, FoundationNameEnrichment, OrgLensGroupsResponse } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors org-people-directory.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into
// this app's vitest config, so runtime collaborators are mocked. `OrgLensBoardCommitteeService`,
// `ProjectService`, and `CommitteeService` are constructed in `OrgLensGroupsService`'s
// constructor, so they must be mocked at module level; `enrichFoundationNames` and
// `getCommitteesByIds` are mocked directly so tests can control each enrichment source
// independently without exercising the real query-service calls underneath.
const { fetchAllOrgSeatsUncached, enrichFoundationNames, getCommitteesByIds, cacheWrites } = vi.hoisted(() => ({
  fetchAllOrgSeatsUncached: vi.fn(),
  enrichFoundationNames: vi.fn(),
  getCommitteesByIds: vi.fn(),
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
  ProjectService: class {},
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

// The `@lfx-one/shared/*` barrels pull Angular into this node-environment suite, so the handful
// of runtime values the service imports are stubbed here. `isBoardCategory` mirrors the real
// implementation, since the non-board filter's behaviour depends on it.
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', () => ({
  isBoardCategory: (category: string | null | undefined) => (category ?? '').trim().toLowerCase() === 'board',
  VALKEY_CACHE: { ORG_LENS_GROUPS_TTL_SECONDS: 900 },
}));

// The cache layer pulls in the Valkey client, which this node suite has no business starting.
// `withOrgGroupsCache` is stubbed as a permanent cache miss that records what its fetcher would
// store in `cacheWrites`, so these tests exercise the aggregation logic and can inspect exactly
// what is shared across callers.
vi.mock('./valkey.service', () => ({
  buildOrgGroupsCacheKey: (orgUid: string) => `test:org-lens-groups:v2:${orgUid}`,
  withOrgGroupsCache: async (_orgUid: string, _ttl: number, fetcher: () => Promise<unknown>) => {
    const value = await fetcher();
    cacheWrites.push(value);
    return value;
  },
}));

import type { Request } from 'express';

import { logger } from './logger.service';
import { OrgLensGroupsService } from './org-lens-groups.service';

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
 * `publicUids` says otherwise; a uid in `publicUids` without a name is public but unnamed.
 */
function foundationNames(names: [string, string][] = [], publicUids: string[] = names.map(([uid]) => uid)): FoundationNameEnrichment {
  return { names: new Map(names), publicUids: new Set(publicUids), cachedHits: 0, requested: 1, resolved: names.length };
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

  it('falls back to the committee-index name for a public project the project index left unnamed (e.g. uepf-style gap)', async () => {
    fetchAllOrgSeatsUncached.mockResolvedValue([seat()]);
    getCommitteesByIds.mockResolvedValue(new Map([['c-1', { uid: 'c-1', project_name: 'Ultra Ethernet Consortium Fund' }]]));
    enrichFoundationNames.mockResolvedValue(foundationNames([], ['p-cncf']));

    const result = await run();

    expect(result.groups[0].project_name).toBe('Ultra Ethernet Consortium Fund');
    // Only the unresolved committee is passed through — the gap-filler is targeted, not blanket.
    expect(getCommitteesByIds).toHaveBeenCalledWith(req, ['c-1']);
    // The corrected metric: 1 gap, resolved by the committee index, 0 left unresolved.
    expect(logger.info).toHaveBeenCalledWith(req, 'org_lens_groups_enrich', expect.any(String), {
      total_committees: 1,
      gaps_from_project_index: 1,
      resolved_from_committee_index: 1,
      unresolved_after_both_sources: 0,
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
    });
  });

  it('omits project_name when neither enrichment nor project_slug is available', async () => {
    fetchAllOrgSeatsUncached.mockResolvedValue([seat({ project_uid: undefined, project_slug: undefined })]);

    const result = await run();

    expect(result.groups[0].project_name).toBeUndefined();
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
    const unnamedPublicSeat = seat({ uid: 'seat-3', committee_uid: 'c-uepf', committee_name: 'UEC WG', project_uid: 'p-uepf', project_slug: 'uepf' });

    it('keeps a private project name the filler can read out of the cached aggregate, from either source', async () => {
      fetchAllOrgSeatsUncached.mockResolvedValue([seat(), privateSeat]);
      // The filler holds `viewer` on p-priv, so the project index names it — but it is not public.
      enrichFoundationNames.mockResolvedValue(
        foundationNames(
          [
            ['p-cncf', 'Cloud Native Computing Foundation'],
            ['p-priv', 'Secret Foundation'],
          ],
          ['p-cncf']
        )
      );
      committeeIndexAnswers({ 'c-priv': 'Secret Foundation' });

      await run();

      const stored = writtenAggregate();
      const priv = stored.groups.find((g) => g.uid === 'c-priv');
      expect(priv?.project_name).toBeUndefined();
      expect(priv?.project_slug).toBe('secret');
      expect(stored.groups.find((g) => g.uid === 'c-1')?.project_name).toBe('Cloud Native Computing Foundation');
      expect(JSON.stringify(stored)).not.toContain('Secret Foundation');
      // A withheld private name is not a gap: the committee index is never asked about it.
      expect(getCommitteesByIds).toHaveBeenCalledWith(req, []);
    });

    it('drops a private project name the committee index returns, while still filling a public gap from it', async () => {
      fetchAllOrgSeatsUncached.mockResolvedValue([privateSeat, unnamedPublicSeat]);
      // p-uepf is public but unnamed in the project index; p-priv is invisible to the project lookup.
      enrichFoundationNames.mockResolvedValue(foundationNames([], ['p-uepf']));
      // Blanket answer: the committee index hands back the private project's name even for a uid
      // it was not asked about, so only the public gate in toGroupSummary keeps it out.
      getCommitteesByIds.mockResolvedValue(
        new Map([
          ['c-priv', { uid: 'c-priv', project_name: 'Secret Foundation' }],
          ['c-uepf', { uid: 'c-uepf', project_name: 'Ultra Ethernet Consortium Fund' }],
        ])
      );

      await run();

      const stored = writtenAggregate();
      expect(getCommitteesByIds).toHaveBeenCalledWith(req, ['c-uepf']);
      expect(stored.groups.find((g) => g.uid === 'c-uepf')?.project_name).toBe('Ultra Ethernet Consortium Fund');
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
});
