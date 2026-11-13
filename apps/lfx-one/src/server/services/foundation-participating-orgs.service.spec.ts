// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { FoundationParticipatingOrgsService } from './foundation-participating-orgs.service';

const req = {} as Request;
const SLUG = 'sample-foundation';
const base = { foundationSlug: SLUG, range: '12mo', segment: 'all', sort: 'commits', dir: 'desc', pageSize: 100, offset: 0 } as const;

describe('FoundationParticipatingOrgsService (demo data)', () => {
  const service = new FoundationParticipatingOrgsService();

  it('ranks companies by commits, descending, by default', () => {
    const { rows, totalRecords } = service.getPage(req, base);
    expect(totalRecords).toBe(rows.length);
    expect(rows.map((row) => row.commits)).toEqual([...rows.map((row) => row.commits)].sort((a, b) => b - a));
  });

  it('splits members and non-members, and the tab counts add up to the companies', () => {
    const summary = service.getSummary(req, { foundationSlug: SLUG, range: '12mo' });
    const members = service.getPage(req, { ...base, segment: 'members' });
    const nonMembers = service.getPage(req, { ...base, segment: 'non_members' });
    expect(members.rows.every((row) => row.isMember)).toBe(true);
    expect(nonMembers.rows.every((row) => !row.isMember)).toBe(true);
    expect(members.totalRecords + nonMembers.totalRecords).toBe(summary?.companiesCount);
  });

  it('filters by tier and by search', () => {
    const platinum = service.getPage(req, { ...base, tier: 'Platinum' });
    expect(platinum.rows.length).toBeGreaterThan(0);
    expect(platinum.rows.every((row) => row.membershipTierClass === 'Platinum')).toBe(true);
    const found = service.getPage(req, { ...base, search: 'northwind' });
    expect(found.rows.map((row) => row.name)).toEqual(['Northwind Labs']);
  });

  it('scopes cards and rows to one project, whose figures are part of the foundation total', () => {
    const [project] = service.getProjects(req, SLUG, '12mo');
    const scoped = service.getSummary(req, { foundationSlug: SLUG, range: '12mo', projectSlug: project.slug });
    const all = service.getSummary(req, { foundationSlug: SLUG, range: '12mo' });
    expect(scoped?.projectSlug).toBe(project.slug);
    expect(scoped!.companiesCount).toBeLessThanOrEqual(all!.companiesCount);
    const page = service.getPage(req, { ...base, projectSlug: project.slug });
    expect(page.totalRecords).toBe(scoped?.companiesCount);
  });

  it('rejects an unknown project', () => {
    expect(() => service.getPage(req, { ...base, projectSlug: 'no-such-project' })).toThrow();
  });

  it('builds a breakdown whose project shares are fractions of the company total, largest project first', () => {
    const [{ participantKey }] = service.getPage(req, base).rows;
    const breakdown = service.getBreakdown(req, SLUG, '12mo', participantKey);
    expect(breakdown.total.shareOfCompanyCommits).toBe(1);
    expect(breakdown.projects.map((line) => line.commits)).toEqual([...breakdown.projects.map((line) => line.commits)].sort((a, b) => b - a));
    expect(breakdown.projects.every((line) => line.shareOfCompanyCommits > 0 && line.shareOfCompanyCommits <= 1)).toBe(true);
  });

  it('exports every project for each company, not only the top 10', () => {
    const { items } = service.getExportRows(req, base, 'by-project');
    expect(items.some((item) => item.lines.length > 10)).toBe(true);
    for (const item of items) expect(item.lines.length).toBe(item.row.projectsInvolved);
  });

  it('narrows the cards and tab counts by search and tier, like the table', () => {
    const search = service.getSummary(req, { foundationSlug: SLUG, range: '12mo', search: 'northwind' });
    expect(search?.companiesCount).toBe(1);
    const platinum = service.getSummary(req, { foundationSlug: SLUG, range: '12mo', tier: 'Platinum' });
    expect(platinum?.companiesCount).toBe(service.getPage(req, { ...base, tier: 'Platinum' }).totalRecords);
    expect(platinum?.nonMembersCount).toBe(0);
    const none = service.getSummary(req, { foundationSlug: SLUG, range: '12mo', search: 'no such company' });
    expect(none?.companiesCount).toBe(0);
  });

  it('lists only the tiers the roster holds, in display order', () => {
    const tiers = service.getSummary(req, { foundationSlug: SLUG, range: '12mo' })?.availableTiers;
    expect(tiers).toEqual(['Platinum', 'Gold', 'Silver']);
  });

  it('marks the figures as demo data', () => {
    expect(service.getSummary(req, { foundationSlug: SLUG, range: '12mo' })?.dataSource).toBe('demo');
  });

  it('limits the by-project export to the selected project under a project scope', () => {
    const [project] = service.getProjects(req, SLUG, '12mo');
    const { items } = service.getExportRows(req, { ...base, projectSlug: project.slug }, 'by-project');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.lines.map((line) => line.projectSlug)).toEqual([project.slug]);
  });

  it('keeps the project shares of a company at 100% in every range, using the displayed rounded figures', () => {
    for (const range of ['12mo', '6mo', '90d', 'all'] as const) {
      const { rows } = service.getPage(req, { ...base, range });
      for (const { participantKey, commits } of rows) {
        const breakdown = service.getBreakdown(req, SLUG, range, participantKey);
        const summed = breakdown.projects.reduce((sum, line) => sum + line.commits, 0);
        const share = breakdown.projects.reduce((sum, line) => sum + line.shareOfCompanyCommits, 0);
        expect(summed).toBe(commits);
        expect(share).toBeCloseTo(1, 6);
      }
    }
  });

  it('computes the change of a company from summed current and previous commits, and has none when any project lacks a comparison', () => {
    const { rows } = service.getPage(req, base);
    const withChange = rows.find((row) => row.commitsChange !== null);
    expect(withChange).toBeDefined();
    const breakdown = service.getBreakdown(req, SLUG, '12mo', withChange!.participantKey);
    const previous = breakdown.projects.reduce((sum, line) => sum + (line.commitsChange === null ? NaN : line.commits / (1 + line.commitsChange)), 0);
    if (!Number.isNaN(previous)) expect(withChange!.commitsChange).toBeCloseTo(withChange!.commits / previous - 1, 1);
    for (const row of rows) {
      const lines = service.getBreakdown(req, SLUG, '12mo', row.participantKey).projects;
      if (lines.some((line) => line.commitsChange === null)) expect(row.commitsChange).toBeNull();
    }
  });

  it('keeps companies with no tier or no comparison last, and orders the rest by the direction', () => {
    const tierRank = (tier: string | null): number => ['Platinum', 'Gold', 'Silver'].indexOf(tier ?? '');
    for (const dir of ['asc', 'desc'] as const) {
      const sign = dir === 'asc' ? 1 : -1;

      const byTier = service.getPage(req, { ...base, sort: 'tier', dir }).rows;
      const members = byTier.filter((row) => row.isMember);
      expect(byTier.slice(0, members.length).every((row) => row.isMember)).toBe(true);
      expect(members.map((row) => tierRank(row.membershipTierClass))).toEqual(
        [...members.map((row) => tierRank(row.membershipTierClass))].sort((a, b) => (a - b) * sign)
      );

      const byChange = service.getPage(req, { ...base, sort: 'commits_change', dir }).rows;
      const present = byChange.filter((row) => row.commitsChange !== null);
      expect(byChange.slice(0, present.length).every((row) => row.commitsChange !== null)).toBe(true);
      expect(present.map((row) => row.commitsChange as number)).toEqual([...present.map((row) => row.commitsChange as number)].sort((a, b) => (a - b) * sign));
      expect(byChange.length).toBeGreaterThan(present.length - 1);

      // All Time has no comparison for anyone, so nothing is dropped and the order falls back to name.
      const allTime = service.getPage(req, { ...base, range: 'all', sort: 'commits_change', dir }).rows;
      expect(allTime.every((row) => row.commitsChange === null)).toBe(true);
      expect(allTime.map((row) => row.name)).toEqual([...allTime.map((row) => row.name)].sort((a, b) => a.localeCompare(b)));
    }
  });

  it('caps the export at the maximum number of CSV rows for either file, and says it was cut', () => {
    const summary = service.getExportRows(req, base, 'summary', 5);
    expect(summary.items).toHaveLength(5);
    expect(summary.truncated).toBe(true);

    const byProject = service.getExportRows(req, base, 'by-project', 25);
    expect(byProject.items.reduce((sum, item) => sum + item.lines.length, 0)).toBe(25);
    expect(byProject.truncated).toBe(true);

    const whole = service.getExportRows(req, base, 'by-project');
    expect(whole.truncated).toBe(false);
    expect(whole.items.reduce((sum, item) => sum + item.lines.length, 0)).toBeGreaterThan(25);
  });

  it('keeps the contributor total of a company between its busiest project and the sum of its projects', () => {
    for (const { participantKey, contributors } of service.getPage(req, base).rows) {
      const lines = service.getBreakdown(req, SLUG, '12mo', participantKey).projects;
      expect(contributors).toBeGreaterThanOrEqual(Math.max(...lines.map((line) => line.contributors)));
      expect(contributors).toBeLessThanOrEqual(lines.reduce((sum, line) => sum + line.contributors, 0));
    }
  });

  it('is deterministic for a foundation', () => {
    expect(service.getPage(req, base)).toEqual(service.getPage(req, base));
  });
});
