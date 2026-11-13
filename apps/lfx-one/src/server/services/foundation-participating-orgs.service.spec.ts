// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEMBERSHIP_TIER_ORDER } from '@lfx-one/shared/constants';
import type {
  FoundationParticipatingOrgsDataSource,
  FoundationParticipatingOrgsSourceCompany,
  FoundationParticipatingOrgsSourceFoundation,
  FoundationParticipatingOrgsSourceProjectLine,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// The service builds the warehouse source lazily; none of these tests reach it, and it must not open a connection.
vi.mock('./foundation-participating-orgs.snowflake-source', () => ({ FoundationParticipatingOrgsSnowflakeSource: class {} }));

import { FoundationParticipatingOrgsService } from './foundation-participating-orgs.service';

const req = {} as Request;
const SLUG = 'sample-foundation';
const base = { foundationSlug: SLUG, range: '12mo', segment: 'all', sort: 'commits', dir: 'desc', pageSize: 100, offset: 0 } as const;

function company(key: string, overrides: Partial<FoundationParticipatingOrgsSourceCompany> = {}): FoundationParticipatingOrgsSourceCompany {
  return {
    key,
    accountId: null,
    name: key,
    logoUrl: null,
    isMember: false,
    tier: null,
    otherMemberships: [],
    projectsInvolved: 1,
    commits: 0,
    commitsChange: null,
    contributors: 0,
    contributorsChange: null,
    ...overrides,
  };
}

function line(
  companyKey: string,
  projectSlug: string,
  commits: number,
  contributors: number,
  change: number | null = null
): FoundationParticipatingOrgsSourceProjectLine {
  return { companyKey, projectSlug, commits, commitsChange: change, contributors, contributorsChange: change };
}

// Alpha's 9 foundation contributors are fewer than its 6 + 5 per-project ones: two people work on both projects.
const FOUNDATION: FoundationParticipatingOrgsSourceFoundation = {
  slug: SLUG,
  name: 'Sample Foundation',
  asOfDate: '2026-11-01',
  projects: [
    { slug: 'quiet', name: 'Quiet', maturity: null, commits: 10 },
    { slug: 'busy', name: 'Busy', maturity: null, commits: 400 },
  ],
  companies: [
    company('alpha', {
      name: 'Alpha Inc',
      isMember: true,
      tier: 'Platinum',
      projectsInvolved: 2,
      commits: 300,
      commitsChange: 0.5,
      contributors: 9,
      contributorsChange: 0.1,
    }),
    company('beta', { name: 'Beta LLC', isMember: true, tier: 'Gold', commits: 110, commitsChange: -0.2, contributors: 4, contributorsChange: null }),
    company('gamma', { name: 'Gamma', projectsInvolved: 1, commits: 5, commitsChange: null, contributors: 2, contributorsChange: null }),
    company('idle', { name: 'Idle Member', isMember: true, tier: 'Silver', projectsInvolved: 0 }),
  ],
};

const LINES = [line('alpha', 'busy', 250, 6, 0.4), line('alpha', 'quiet', 5, 5, null), line('beta', 'busy', 110, 4, -0.2), line('gamma', 'quiet', 5, 2, null)];

describe('FoundationParticipatingOrgsService', () => {
  const getFoundation = vi.fn();
  const getProjectLines = vi.fn();
  let service: FoundationParticipatingOrgsService;

  beforeEach(() => {
    vi.clearAllMocks();
    getFoundation.mockResolvedValue(FOUNDATION);
    getProjectLines.mockImplementation(async (_slug, _range, filter) =>
      LINES.filter((item) => (!filter.projectSlug || item.projectSlug === filter.projectSlug) && (!filter.companyKey || item.companyKey === filter.companyKey))
    );
    service = new FoundationParticipatingOrgsService({ getFoundation, getProjectLines } as FoundationParticipatingOrgsDataSource);
  });

  it('passes the requested range to the source, for every read', async () => {
    await service.getSummary(req, { foundationSlug: SLUG, range: '30d' });
    await service.getPage(req, { ...base, range: '90d' });
    await service.getProjects(req, SLUG, 'all');
    expect(getFoundation.mock.calls.map((call) => call[1])).toEqual(['30d', '90d', 'all']);
  });

  it('lists companies with activity by commits and leaves the idle member out of the table', async () => {
    const { rows, totalRecords } = await service.getPage(req, base);
    expect(rows.map((row) => row.name)).toEqual(['Alpha Inc', 'Beta LLC', 'Gamma']);
    expect(totalRecords).toBe(3);
  });

  it('reports the foundation contributor total as the source gives it, never as the sum of its projects', async () => {
    const alpha = (await service.getPage(req, base)).rows.find((row) => row.participantKey === 'alpha');
    expect(alpha?.contributors).toBe(9);
    expect(alpha?.contributors).toBeLessThan(6 + 5);
    expect(alpha?.contributorsChange).toBe(0.1);
    const breakdown = await service.getBreakdown(req, SLUG, '12mo', 'alpha');
    expect(breakdown.total.contributors).toBe(9);
    expect(breakdown.total.commits).toBe(300);
  });

  it('counts the roster in the tab counts: members include the idle one, contributors do not', async () => {
    const summary = await service.getSummary(req, { foundationSlug: SLUG, range: '12mo' });
    expect(summary).toMatchObject({
      foundationName: 'Sample Foundation',
      projectCount: 2,
      asOfDate: '2026-11-01',
      companiesCount: 3,
      membersCount: 3,
      contributingMembersCount: 2,
      nonMembersCount: 1,
    });
    expect(summary?.memberCommitShare).toBeCloseTo(410 / 415, 6);
    expect(summary?.availableTiers).toEqual(MEMBERSHIP_TIER_ORDER.filter((tier) => ['Platinum', 'Gold', 'Silver'].includes(tier)));
    expect(summary).not.toHaveProperty('dataSource');
  });

  it('answers the empty state when no company has activity, and for a foundation the warehouse does not know', async () => {
    getFoundation.mockResolvedValueOnce({ ...FOUNDATION, companies: [company('idle', { isMember: true, tier: 'Silver' })] });
    expect(await service.getSummary(req, { foundationSlug: SLUG, range: '12mo' })).toBeNull();
    getFoundation.mockResolvedValueOnce(null);
    expect(await service.getSummary(req, { foundationSlug: 'unknown', range: '12mo' })).toBeNull();
    getFoundation.mockResolvedValueOnce(null);
    expect(await service.getProjects(req, 'unknown', '12mo')).toEqual([]);
    getFoundation.mockResolvedValueOnce(null);
    expect((await service.getPage(req, { ...base, foundationSlug: 'unknown' })).rows).toEqual([]);
  });

  it('splits members and non-members', async () => {
    const members = await service.getPage(req, { ...base, segment: 'members' });
    const nonMembers = await service.getPage(req, { ...base, segment: 'non_members' });
    expect(members.rows.map((row) => row.name)).toEqual(['Alpha Inc', 'Beta LLC']);
    expect(nonMembers.rows.map((row) => row.name)).toEqual(['Gamma']);
  });

  it('filters by tier and by search, narrowing the cards the same way', async () => {
    expect((await service.getPage(req, { ...base, tier: 'Gold' })).rows.map((row) => row.name)).toEqual(['Beta LLC']);
    expect((await service.getPage(req, { ...base, search: 'ALPHA' })).rows.map((row) => row.name)).toEqual(['Alpha Inc']);
    const summary = await service.getSummary(req, { foundationSlug: SLUG, range: '12mo', tier: 'Gold' });
    expect(summary).toMatchObject({ companiesCount: 1, membersCount: 1, nonMembersCount: 0 });
    expect((await service.getSummary(req, { foundationSlug: SLUG, range: '12mo', search: 'nobody' }))?.companiesCount).toBe(0);
  });

  it('orders the project picker busiest first', async () => {
    expect((await service.getProjects(req, SLUG, '12mo')).map((project) => project.slug)).toEqual(['busy', 'quiet']);
  });

  it("scopes cards and rows to one project from that project's own lines, and reads only that project", async () => {
    const page = await service.getPage(req, { ...base, projectSlug: 'quiet' });
    expect(page.rows.map((row) => [row.name, row.commits, row.contributors])).toEqual([
      ['Alpha Inc', 5, 5],
      ['Gamma', 5, 2],
    ]);
    expect(getProjectLines).toHaveBeenCalledWith(SLUG, '12mo', { projectSlug: 'quiet' });
    const summary = await service.getSummary(req, { foundationSlug: SLUG, range: '12mo', projectSlug: 'quiet' });
    expect(summary).toMatchObject({ projectSlug: 'quiet', projectName: 'Quiet', companiesCount: 2 });
  });

  it('rejects an unknown project', async () => {
    await expect(service.getPage(req, { ...base, projectSlug: 'no-such-project' })).rejects.toThrow();
    getFoundation.mockResolvedValueOnce(null);
    await expect(service.getSummary(req, { foundationSlug: 'unknown', range: '12mo', projectSlug: 'x' })).rejects.toThrow();
  });

  it('builds a breakdown whose shares are fractions of the company foundation commits, largest project first', async () => {
    const breakdown = await service.getBreakdown(req, SLUG, '12mo', 'alpha');
    expect(breakdown.total.shareOfCompanyCommits).toBe(1);
    expect(breakdown.projects.map((item) => [item.projectSlug, item.commits])).toEqual([
      ['busy', 250],
      ['quiet', 5],
    ]);
    expect(breakdown.projects[0].shareOfCompanyCommits).toBeCloseTo(250 / 300, 6);
    expect(getProjectLines).toHaveBeenCalledWith(SLUG, '12mo', { companyKey: 'alpha' });
  });

  it('answers not found for the breakdown of a company without activity or an unknown one', async () => {
    await expect(service.getBreakdown(req, SLUG, '12mo', 'idle')).rejects.toThrow();
    await expect(service.getBreakdown(req, SLUG, '12mo', 'nobody')).rejects.toThrow();
  });

  it('keeps companies with no tier or no comparison last, and orders the rest by the direction', async () => {
    for (const dir of ['asc', 'desc'] as const) {
      const byTier = (await service.getPage(req, { ...base, sort: 'tier', dir })).rows;
      expect(byTier.at(-1)?.name).toBe('Gamma');
      expect(byTier.slice(0, 2).map((row) => row.name)).toEqual(dir === 'asc' ? ['Alpha Inc', 'Beta LLC'] : ['Beta LLC', 'Alpha Inc']);

      const byChange = (await service.getPage(req, { ...base, sort: 'contributors_change', dir })).rows;
      expect(byChange.map((row) => row.name)).toEqual(['Alpha Inc', 'Beta LLC', 'Gamma']);
      expect(byChange.at(-1)?.contributorsChange).toBeNull();
    }
  });

  it('pages the sorted rows', async () => {
    const page = await service.getPage(req, { ...base, pageSize: 1, offset: 1 });
    expect(page.rows.map((row) => row.name)).toEqual(['Beta LLC']);
    expect(page.totalRecords).toBe(3);
  });

  describe('export', () => {
    it('writes one row per company for the summary file, capped and flagged', async () => {
      const whole = await service.getExportRows(req, base, 'summary');
      expect(whole.items.map((item) => item.row.name)).toEqual(['Alpha Inc', 'Beta LLC', 'Gamma']);
      expect(whole.truncated).toBe(false);
      const capped = await service.getExportRows(req, base, 'summary', 2);
      expect(capped.items).toHaveLength(2);
      expect(capped.truncated).toBe(true);
    });

    it('writes every project line of each company, from one bounded read', async () => {
      const { items, truncated } = await service.getExportRows(req, base, 'by-project');
      expect(items.map((item) => item.lines.map((entry) => entry.projectSlug))).toEqual([['busy', 'quiet'], ['busy'], ['quiet']]);
      expect(truncated).toBe(false);
      expect(getProjectLines).toHaveBeenCalledTimes(1);
      expect(getProjectLines.mock.calls[0][2].limit).toBeGreaterThan(0);
    });

    it('limits the by-project file to the selected project under a project scope', async () => {
      const { items } = await service.getExportRows(req, { ...base, projectSlug: 'quiet' }, 'by-project');
      expect(items.map((item) => item.row.name)).toEqual(['Alpha Inc', 'Gamma']);
      for (const item of items) expect(item.lines.map((entry) => entry.projectSlug)).toEqual(['quiet']);
    });

    it('stops at the row cap and says it was cut', async () => {
      const { items, truncated } = await service.getExportRows(req, base, 'by-project', 2);
      expect(items.reduce((sum, item) => sum + item.lines.length, 0)).toBe(2);
      expect(truncated).toBe(true);
    });

    it('says the file is cut when the warehouse read hit the bound', async () => {
      getProjectLines.mockResolvedValueOnce([LINES[0], LINES[1], LINES[2]]);
      const { truncated } = await service.getExportRows(req, base, 'by-project', 2);
      expect(truncated).toBe(true);
    });
  });
});
