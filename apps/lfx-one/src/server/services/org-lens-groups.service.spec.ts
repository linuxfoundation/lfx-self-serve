// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensGroupsResponse } from '@lfx-one/shared/interfaces';
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
}));

import { OrgLensGroupsService } from './org-lens-groups.service';

const ORG_UID = 'org-1';
const req = {} as never;

function seat(over: Record<string, unknown> = {}): never {
  return {
    uid: 'seat-1',
    committee_uid: 'c-1',
    committee_name: 'WG Identity & Trust',
    committee_category: 'Working Group',
    email: 'dclarke@contractor.lfx-partner.example',
    project_uid: 'p-cncf',
    project_slug: 'cncf',
    ...over,
  } as never;
}

async function run(): Promise<OrgLensGroupsResponse> {
  return new OrgLensGroupsService().getGroups(req, ORG_UID);
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
  it('prefers the committee-index name over the project-index name and the raw slug', async () => {
    fetchAllOrgSeats.mockResolvedValue([seat()]);
    getCommitteesByIds.mockResolvedValue(new Map([['c-1', { uid: 'c-1', project_name: 'Cloud Native Computing Foundation (CNCF)' }]]));
    enrichFoundationNames.mockResolvedValue(new Map([['p-cncf', 'Cloud Native Computing Foundation']]));

    const result = await run();

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].project_name).toBe('Cloud Native Computing Foundation (CNCF)');
    expect(result.groups[0].project_slug).toBe('cncf');
  });

  it('falls back to the project-index name when the committee index has no match', async () => {
    fetchAllOrgSeats.mockResolvedValue([seat()]);
    getCommitteesByIds.mockResolvedValue(new Map());
    enrichFoundationNames.mockResolvedValue(new Map([['p-cncf', 'Cloud Native Computing Foundation']]));

    const result = await run();

    expect(result.groups[0].project_name).toBe('Cloud Native Computing Foundation');
  });

  it('omits project_name (but keeps project_slug) when both enrichment sources miss', async () => {
    fetchAllOrgSeats.mockResolvedValue([seat()]);

    const result = await run();

    expect(result.groups[0].project_name).toBeUndefined();
    expect(result.groups[0].project_slug).toBe('cncf');
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
