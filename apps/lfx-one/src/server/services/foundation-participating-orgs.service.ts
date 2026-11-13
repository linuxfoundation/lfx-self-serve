// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FOUNDATION_PARTICIPATING_ORGS_DEMO_RANGE_SCALE,
  FOUNDATION_PARTICIPATING_ORGS_EXPORT_MAX_ROWS,
  MEMBERSHIP_TIER_ORDER,
} from '@lfx-one/shared/constants';
import type {
  FoundationCompanyActivity,
  FoundationParticipatingOrg,
  FoundationParticipatingOrgBreakdown,
  FoundationParticipatingOrgProjectLine,
  FoundationParticipatingOrgsDataSource,
  FoundationParticipatingOrgsExportFilters,
  FoundationParticipatingOrgsExportKind,
  FoundationParticipatingOrgsPage,
  FoundationParticipatingOrgsProject,
  FoundationParticipatingOrgsQuery,
  FoundationParticipatingOrgsRange,
  FoundationParticipatingOrgsSummary,
  FoundationParticipatingOrgsSourceFoundation,
  FoundationParticipatingOrgsSummaryQuery,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { getDemoFoundation } from './foundation-participating-orgs.demo-data';
import { logger } from './logger.service';

const demoSource: FoundationParticipatingOrgsDataSource = {
  kind: 'demo',
  rangeScale: FOUNDATION_PARTICIPATING_ORGS_DEMO_RANGE_SCALE,
  getFoundation: getDemoFoundation,
};

export class FoundationParticipatingOrgsService {
  public constructor(private readonly source: FoundationParticipatingOrgsDataSource = demoSource) {}

  public getProjects(req: Request, slug: string, range: FoundationParticipatingOrgsRange): FoundationParticipatingOrgsProject[] {
    logger.debug(req, 'get_foundation_participating_orgs_projects', 'Building project scope list', { slug, range });
    const foundation = this.source.getFoundation(slug);
    // Each project's total is summed once, then the list is ordered busiest first; the figure itself is not part of the picker.
    const totals = new Map<string, number>();
    for (const company of foundation.companies) {
      for (const project of company.projects) totals.set(project.projectSlug, (totals.get(project.projectSlug) ?? 0) + project.commits);
    }
    return [...foundation.projects]
      .sort((a, b) => (totals.get(b.slug) ?? 0) - (totals.get(a.slug) ?? 0))
      .map((project) => ({ slug: project.slug, name: project.name, maturity: project.maturity }));
  }

  public getSummary(req: Request, query: FoundationParticipatingOrgsSummaryQuery): FoundationParticipatingOrgsSummary | null {
    const { foundationSlug: slug, range, projectSlug } = query;
    logger.debug(req, 'get_foundation_participating_orgs_summary', 'Building summary', { slug, range, project_slug: projectSlug });
    const foundation = this.source.getFoundation(slug);
    const project = this.resolveProject(foundation, projectSlug);
    const base = this.activities(foundation, range, projectSlug);
    // No activity at all in scope is the empty state; a search or tier that matches nothing still gets its zeros.
    if (base.length === 0) return null;

    const matching = base.filter(({ row }) => matches(row, query));
    const members = matching.filter((item) => item.row.isMember);
    const commits = matching.reduce((sum, item) => sum + item.row.commits, 0);
    const memberCommits = members.reduce((sum, item) => sum + item.row.commits, 0);
    return {
      foundationSlug: slug,
      dataSource: this.source.kind,
      foundationName: foundation.name,
      projectCount: foundation.projects.length,
      projectSlug: project?.slug ?? null,
      projectName: project?.name ?? null,
      range,
      asOfDate: new Date().toISOString().slice(0, 10),
      availableTiers: MEMBERSHIP_TIER_ORDER.filter((tier) => foundation.companies.some((company) => company.tier === tier)),
      companiesCount: matching.length,
      membersCount: foundation.companies.filter((company) => company.tier !== null && matches({ name: company.name, membershipTierClass: company.tier }, query))
        .length,
      contributingMembersCount: members.length,
      nonMembersCount: matching.length - members.length,
      memberCommitShare: commits > 0 ? memberCommits / commits : null,
    };
  }

  public getPage(req: Request, query: FoundationParticipatingOrgsQuery): FoundationParticipatingOrgsPage {
    logger.debug(req, 'get_foundation_participating_orgs', 'Building company page', {
      slug: query.foundationSlug,
      segment: query.segment,
      offset: query.offset,
    });
    const rows = this.filtered(query).map((item) => item.row);
    return { rows: rows.slice(query.offset, query.offset + query.pageSize), totalRecords: rows.length };
  }

  /** Every project line for one company (the client shows the top 10 and folds the rest into "Other N projects"). */
  public getBreakdown(req: Request, slug: string, range: FoundationParticipatingOrgsRange, companyKey: string): FoundationParticipatingOrgBreakdown {
    logger.debug(req, 'get_foundation_participating_orgs_breakdown', 'Building project breakdown', { slug, range, company_key: companyKey });
    const foundation = this.source.getFoundation(slug);
    const item = this.activities(foundation, range, undefined, companyKey)[0];
    if (!item) {
      throw new ResourceNotFoundError('Company', companyKey, { operation: 'get_foundation_participating_orgs_breakdown' });
    }
    const total: FoundationParticipatingOrgProjectLine = {
      projectSlug: slug,
      name: `${foundation.name} total`,
      maturity: null,
      commits: item.row.commits,
      commitsChange: item.row.commitsChange,
      contributors: item.row.contributors,
      contributorsChange: item.row.contributorsChange,
      shareOfCompanyCommits: 1,
    };
    return { total, projects: item.lines };
  }

  /**
   * Companies matching the filters, ready for a CSV file, with the row cap applied here: a summary file is one row per company,
   * a by-project file one row per company and project, and `truncated` says whether the cap cut anything. Under a project
   * scope the by-project lines are that project's only, matching the table and the summary file.
   */
  public getExportRows(
    req: Request,
    filters: FoundationParticipatingOrgsExportFilters,
    kind: FoundationParticipatingOrgsExportKind,
    maxRows: number = FOUNDATION_PARTICIPATING_ORGS_EXPORT_MAX_ROWS
  ): { items: FoundationCompanyActivity[]; truncated: boolean } {
    logger.debug(req, 'export_foundation_participating_orgs', 'Building export rows', { slug: filters.foundationSlug, kind });
    const scoped = this.filtered(filters).map((item) =>
      filters.projectSlug ? { ...item, lines: item.lines.filter((line) => line.projectSlug === filters.projectSlug) } : item
    );
    if (kind === 'summary') {
      return { items: scoped.slice(0, maxRows), truncated: scoped.length > maxRows };
    }

    const items: FoundationCompanyActivity[] = [];
    let remaining = maxRows;
    for (const item of scoped) {
      if (remaining <= 0) return { items, truncated: true };
      const lines = item.lines.slice(0, remaining);
      items.push({ ...item, lines });
      remaining -= lines.length;
      if (lines.length < item.lines.length) return { items, truncated: true };
    }
    return { items, truncated: false };
  }

  private filtered(filters: FoundationParticipatingOrgsExportFilters): FoundationCompanyActivity[] {
    const foundation = this.source.getFoundation(filters.foundationSlug);
    this.resolveProject(foundation, filters.projectSlug);
    const items = this.activities(foundation, filters.range, filters.projectSlug).filter(({ row }) => {
      if (filters.segment === 'members' && !row.isMember) return false;
      if (filters.segment === 'non_members' && row.isMember) return false;
      return matches(row, filters);
    });
    const direction = filters.dir === 'asc' ? 1 : -1;
    return items.sort((a, b) => {
      // A missing comparison or tier goes last in both directions; the direction only orders the values that exist.
      const missingA = isMissing(a.row, filters.sort);
      const missingB = isMissing(b.row, filters.sort);
      if (missingA !== missingB) return missingA ? 1 : -1;
      return (missingA ? 0 : compare(a.row, b.row, filters.sort) * direction) || a.row.name.localeCompare(b.row.name);
    });
  }

  private resolveProject(foundation: FoundationParticipatingOrgsSourceFoundation, projectSlug?: string): { slug: string; name: string } | null {
    if (!projectSlug) return null;
    const project = foundation.projects.find((candidate) => candidate.slug === projectSlug);
    if (!project) throw new ResourceNotFoundError('Project', projectSlug, { operation: 'resolve_foundation_participating_orgs_project' });
    return project;
  }

  /** Foundation totals for every company with activity in the range, or that project's figures when scoped to one. */
  private activities(
    foundation: FoundationParticipatingOrgsSourceFoundation,
    range: FoundationParticipatingOrgsRange,
    projectSlug?: string,
    companyKey?: string
  ): FoundationCompanyActivity[] {
    const scale = this.source.rangeScale[range];
    const names = new Map(foundation.projects.map((project) => [project.slug, project]));
    const items: FoundationCompanyActivity[] = [];

    // A breakdown names one company, so only that company is built instead of the whole roster.
    const companies = companyKey ? foundation.companies.filter((company) => company.key === companyKey) : foundation.companies;
    for (const company of companies) {
      const scoped = projectSlug ? company.projects.filter((project) => project.projectSlug === projectSlug) : company.projects;
      if (scoped.length === 0) continue;

      // Each project's figure is rounded once and every total, share and change below is built from those displayed values.
      const scaledCommits = new Map(company.projects.map((project) => [project.projectSlug, Math.max(1, Math.round(project.commits * scale))]));
      const totalCommits = [...scaledCommits.values()].reduce((sum, value) => sum + value, 0);
      const lines = company.projects
        .map((project) => ({
          projectSlug: project.projectSlug,
          name: names.get(project.projectSlug)?.name ?? project.projectSlug,
          maturity: names.get(project.projectSlug)?.maturity ?? null,
          commits: scaledCommits.get(project.projectSlug) ?? 1,
          commitsChange: range === 'all' ? null : project.commitsChange,
          contributors: project.contributors,
          contributorsChange: range === 'all' ? null : project.contributorsChange,
          shareOfCompanyCommits: (scaledCommits.get(project.projectSlug) ?? 1) / totalCommits,
        }))
        .sort((a, b) => b.commits - a.commits);

      const commits = scoped.reduce((sum, project) => sum + (scaledCommits.get(project.projectSlug) ?? 1), 0);
      const single = projectSlug ? scoped[0] : null;
      const foundationChange = combinedChange(
        scoped.map((project) => ({ commits: scaledCommits.get(project.projectSlug) ?? 1, change: project.commitsChange }))
      );
      const commitsChange = single ? single.commitsChange : foundationChange;
      const contributorsChange = single ? single.contributorsChange : company.foundationContributorsChange;
      const row: FoundationParticipatingOrg = {
        participantKey: company.key,
        accountId: null,
        name: company.name,
        logoUrl: null,
        isMember: company.tier !== null,
        membershipTierClass: company.tier,
        otherMemberships: company.otherMemberships,
        projectsInvolved: company.projects.length,
        commits,
        commitsChange: range === 'all' ? null : commitsChange,
        contributors: single ? single.contributors : company.foundationContributors,
        contributorsChange: range === 'all' ? null : contributorsChange,
      };
      items.push({ row, lines });
    }
    return items;
  }
}

/**
 * Growth of a sum of projects: current commits against the summed previous-period commits (each project's previous is its
 * current divided by 1 + its change). Null when any project has no comparison, so a missing figure is never read as zero growth.
 */
function combinedChange(parts: { commits: number; change: number | null }[]): number | null {
  if (parts.some((part) => part.change === null || part.change <= -1)) return null;
  const current = parts.reduce((sum, part) => sum + part.commits, 0);
  const previous = parts.reduce((sum, part) => sum + part.commits / (1 + (part.change ?? 0)), 0);
  return previous > 0 ? Math.round((current / previous - 1) * 100) / 100 : null;
}

/** Search (name substring) and tier narrow every figure on the page; the tab and project scope are applied separately. */
function matches(
  row: { name: string; membershipTierClass: FoundationParticipatingOrg['membershipTierClass'] },
  filters: { search?: string; tier?: FoundationParticipatingOrg['membershipTierClass'] | undefined }
): boolean {
  if (filters.tier && row.membershipTierClass !== filters.tier) return false;
  const search = filters.search?.toLowerCase();
  return !search || row.name.toLowerCase().includes(search);
}

/** No % change to compare (All Time, or a project without one), or no membership tier (a non-member). */
function isMissing(row: FoundationParticipatingOrg, field: FoundationParticipatingOrgsQuery['sort']): boolean {
  switch (field) {
    case 'commits_change':
      return row.commitsChange === null;
    case 'contributors_change':
      return row.contributorsChange === null;
    case 'tier':
      return row.membershipTierClass === null;
    default:
      return false;
  }
}

function compare(a: FoundationParticipatingOrg, b: FoundationParticipatingOrg, field: FoundationParticipatingOrgsQuery['sort']): number {
  switch (field) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'tier':
      return tierRank(a) - tierRank(b);
    case 'commits':
      return a.commits - b.commits;
    case 'commits_change':
      return (a.commitsChange ?? 0) - (b.commitsChange ?? 0);
    case 'contributors':
      return a.contributors - b.contributors;
    case 'contributors_change':
      return (a.contributorsChange ?? 0) - (b.contributorsChange ?? 0);
  }
}

/** Platinum first; non-members last. */
function tierRank(row: FoundationParticipatingOrg): number {
  if (!row.membershipTierClass) return MEMBERSHIP_TIER_ORDER.length + 1;
  const index = (MEMBERSHIP_TIER_ORDER as readonly string[]).indexOf(row.membershipTierClass);
  return index === -1 ? MEMBERSHIP_TIER_ORDER.length : index;
}
