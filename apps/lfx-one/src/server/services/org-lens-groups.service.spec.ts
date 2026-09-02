// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CommitteeServiceOrgSeat, OrgLensGroupsResponse } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors org-people-directory.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into
// this app's vitest config, so runtime collaborators are mocked. `OrgLensBoardCommitteeService`,
// `ProjectService`, and `CommitteeService` are constructed in `OrgLensGroupsService`'s
// constructor, so they must be mocked at module level; `enrichFoundationNames` and
// `getCommitteesByIds` are mocked directly so tests can control each enrichment source
// independently without exercising the real query-service calls underneath.
const { fetchAllOrgSeats, enrichFoundationNames, getCommitteesByIds } = vi.hoisted(() => ({
  fetchAllOrgSeats: vi.fn(),
  enrichFoundationNames: vi.fn(),
  getCommitteesByIds: vi.fn(),
}));

vi.mock('./org-lens-board-committee.service', () => ({
  OrgLensBoardCommitteeService: class {
    public fetchAllOrgSeats = fetchAllOrgSeats;
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
// `withOrgGroupsCache` is stubbed as a straight pass-through to its fetcher — i.e. a permanent
// cache miss — so these tests keep exercising the aggregation logic rather than the cache.
vi.mock('./valkey.service', () => ({
  buildOrgGroupsCacheKey: (orgUid: string) => `test:org-lens-groups:v1:${orgUid}`,
  withOrgGroupsCache: (_orgUid: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher(),
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
  // `org-grant` is the shared-cache path; a staff-only caller would bypass the cache entirely.
  return new OrgLensGroupsService().getGroups(req, ORG_UID, 'org-grant');
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default both enrichment sources to "no match" so each test only sets up the source it's
  // actually exercising.
  enrichFoundationNames.mockResolvedValue(new Map());
  getCommitteesByIds.mockResolvedValue(new Map());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OrgLensGroupsService.getGroups', () => {
  it('uses the live project-index name and never asks the committee index about that group', async () => {
    fetchAllOrgSeats.mockResolvedValue([seat()]);
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
    enrichFoundationNames.mockResolvedValue(new Map([['p-cncf', 'Cloud Native Computing Foundation']]));

    const result = await run();

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].project_name).toBe('Cloud Native Computing Foundation');
    expect(result.groups[0].project_slug).toBe('cncf');
  });

  it('skips the committee-index fan-out entirely when the project index already resolved every group', async () => {
    fetchAllOrgSeats.mockResolvedValue([seat()]);
    enrichFoundationNames.mockResolvedValue(new Map([['p-cncf', 'Cloud Native Computing Foundation']]));

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

  it('falls back to the committee-index name when the project index has no match (e.g. uepf-style gap)', async () => {
    fetchAllOrgSeats.mockResolvedValue([seat()]);
    getCommitteesByIds.mockResolvedValue(new Map([['c-1', { uid: 'c-1', project_name: 'Ultra Ethernet Consortium Fund' }]]));
    enrichFoundationNames.mockResolvedValue(new Map());

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
    fetchAllOrgSeats.mockResolvedValue([seat()]);

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
    fetchAllOrgSeats.mockResolvedValue([seat({ project_uid: undefined, project_slug: undefined })]);

    const result = await run();

    expect(result.groups[0].project_name).toBeUndefined();
  });

  it('still returns groups (falling back to the slug) when the committee-index lookup throws', async () => {
    fetchAllOrgSeats.mockResolvedValue([seat()]);
    getCommitteesByIds.mockRejectedValue(new Error('query-service unavailable'));
    enrichFoundationNames.mockResolvedValue(new Map());

    const result = await run();

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].project_name).toBeUndefined();
    expect(result.groups[0].project_slug).toBe('cncf');
  });

  it('excludes board committees from the roster', async () => {
    fetchAllOrgSeats.mockResolvedValue([seat({ committee_category: 'Board' })]);

    const result = await run();

    expect(result.groups).toHaveLength(0);
    expect(result.total_groups).toBe(0);
  });
});
