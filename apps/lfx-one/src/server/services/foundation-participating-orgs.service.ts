// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_PARTICIPATING_ORGS_EXPORT_MAX_ROWS, MEMBERSHIP_TIER_ORDER } from '@lfx-one/shared/constants';
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
  FoundationParticipatingOrgsSourceCompany,
  FoundationParticipatingOrgsSourceFoundation,
  FoundationParticipatingOrgsSourceProjectLine,
  FoundationParticipatingOrgsSummary,
  FoundationParticipatingOrgsSummaryQuery,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { FoundationParticipatingOrgsSnowflakeSource } from './foundation-participating-orgs.snowflake-source';
import { logger } from './logger.service';

export class FoundationParticipatingOrgsService {
  private source: FoundationParticipatingOrgsDataSource | null;

  /** The warehouse source is created on first use, so building the service never opens a Snowflake connection. */
  public constructor(source?: FoundationParticipatingOrgsDataSource) {
    this.source = source ?? null;
  }

  public async getProjects(req: Request, slug: string, range: FoundationParticipatingOrgsRange): Promise<FoundationParticipatingOrgsProject[]> {
    logger.debug(req, 'get_foundation_participating_orgs_projects', 'Reading project scope list', { slug, range });
    const foundation = await this.dataSource().getFoundation(slug, range);
    if (!foundation) return [];
    // Busiest first; the figure itself is not part of the picker.
    return [...foundation.projects]
      .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name))
      .map((project) => ({ slug: project.slug, name: project.name, maturity: project.maturity }));
  }

  public async getSummary(req: Request, query: FoundationParticipatingOrgsSummaryQuery): Promise<FoundationParticipatingOrgsSummary | null> {
    const { foundationSlug: slug, range, projectSlug } = query;
    logger.debug(req, 'get_foundation_participating_orgs_summary', 'Reading summary', { slug, range, project_slug: projectSlug });
    const foundation = await this.dataSource().getFoundation(slug, range);
    if (!foundation) {
      if (projectSlug) throw new ResourceNotFoundError('Project', projectSlug, { operation: 'resolve_foundation_participating_orgs_project' });
      return null;
    }
    const project = this.resolveProject(foundation, projectSlug);
    const base = await this.rows(foundation, range, projectSlug);
    // No activity at all in scope is the empty state; a search or tier that matches nothing still gets its zeros.
    if (base.length === 0) return null;

    const matching = base.filter((row) => matches(row, query));
    const members = matching.filter((row) => row.isMember);
    const commits = matching.reduce((sum, row) => sum + row.commits, 0);
    const memberCommits = members.reduce((sum, row) => sum + row.commits, 0);
    return {
      foundationSlug: slug,
      foundationName: foundation.name,
      projectCount: foundation.projects.length,
      projectSlug: project?.slug ?? null,
      projectName: project?.name ?? null,
      range,
      asOfDate: foundation.asOfDate ?? new Date().toISOString().slice(0, 10),
      availableTiers: MEMBERSHIP_TIER_ORDER.filter((tier) => foundation.companies.some((company) => company.tier === tier)),
      companiesCount: matching.length,
      membersCount: foundation.companies.filter((company) => company.isMember && matches({ name: company.name, membershipTierClass: company.tier }, query))
        .length,
      contributingMembersCount: members.length,
      nonMembersCount: matching.length - members.length,
      memberCommitShare: commits > 0 ? memberCommits / commits : null,
    };
  }

  public async getPage(req: Request, query: FoundationParticipatingOrgsQuery): Promise<FoundationParticipatingOrgsPage> {
    logger.debug(req, 'get_foundation_participating_orgs', 'Reading company page', {
      slug: query.foundationSlug,
      segment: query.segment,
      offset: query.offset,
    });
    const rows = await this.filtered(query);
    return { rows: rows.slice(query.offset, query.offset + query.pageSize), totalRecords: rows.length };
  }

  /** Every project line for one company (the client shows the top 10 and folds the rest into "Other N projects"). */
  public async getBreakdown(
    req: Request,
    slug: string,
    range: FoundationParticipatingOrgsRange,
    companyKey: string
  ): Promise<FoundationParticipatingOrgBreakdown> {
    logger.debug(req, 'get_foundation_participating_orgs_breakdown', 'Reading project breakdown', { slug, range, company_key: companyKey });
    const foundation = await this.dataSource().getFoundation(slug, range);
    const company = foundation?.companies.find((candidate) => candidate.key === companyKey);
    if (!foundation || !company || !isActive(company)) {
      throw new ResourceNotFoundError('Company', companyKey, { operation: 'get_foundation_participating_orgs_breakdown' });
    }
    const lines = await this.dataSource().getProjectLines(slug, range, { companyKey });
    const total: FoundationParticipatingOrgProjectLine = {
      projectSlug: slug,
      name: `${foundation.name} total`,
      maturity: null,
      commits: company.commits,
      commitsChange: company.commitsChange,
      contributors: company.contributors,
      contributorsChange: company.contributorsChange,
      shareOfCompanyCommits: 1,
    };
    return { total, projects: toProjectLines(foundation, company, lines) };
  }

  /**
   * Companies matching the filters, ready for a CSV file, with the row cap applied here: a summary file is one row per company,
   * a by-project file one row per company and project, and `truncated` says whether the cap cut anything. Under a project
   * scope the by-project lines are that project's only, matching the table and the summary file.
   */
  public async getExportRows(
    req: Request,
    filters: FoundationParticipatingOrgsExportFilters,
    kind: FoundationParticipatingOrgsExportKind,
    maxRows: number = FOUNDATION_PARTICIPATING_ORGS_EXPORT_MAX_ROWS
  ): Promise<{ items: FoundationCompanyActivity[]; truncated: boolean }> {
    logger.debug(req, 'export_foundation_participating_orgs', 'Reading export rows', { slug: filters.foundationSlug, kind });
    const rows = await this.filtered(filters);
    if (kind === 'summary') {
      return { items: rows.slice(0, maxRows).map((row) => ({ row, lines: [] })), truncated: rows.length > maxRows };
    }

    const foundation = await this.dataSource().getFoundation(filters.foundationSlug, filters.range);
    if (!foundation) return { items: [], truncated: false };
    // Only the matching companies' lines are read, as many companies as the cap can hold: the filters and the order apply first,
    // so unrelated companies never take the row budget. One past the cap says the warehouse had more than the file can hold.
    const companyKeys: string[] = [];
    let budget = 0;
    for (const row of rows) {
      companyKeys.push(row.participantKey);
      budget += Math.max(1, row.projectsInvolved);
      if (budget > maxRows) break;
    }
    const read = await this.dataSource().getProjectLines(filters.foundationSlug, filters.range, {
      projectSlug: filters.projectSlug,
      companyKeys,
      limit: maxRows + 1,
    });
    const byCompany = new Map<string, FoundationParticipatingOrgsSourceProjectLine[]>();
    for (const line of read) byCompany.set(line.companyKey, [...(byCompany.get(line.companyKey) ?? []), line]);

    const companies = new Map(foundation.companies.map((company) => [company.key, company]));
    const items: FoundationCompanyActivity[] = [];
    let remaining = maxRows;
    for (const row of rows) {
      const company = companies.get(row.participantKey);
      const lines = company ? toProjectLines(foundation, company, byCompany.get(row.participantKey) ?? []) : [];
      if (remaining <= 0) return { items, truncated: true };
      const kept = lines.slice(0, remaining);
      items.push({ row, lines: kept });
      remaining -= kept.length;
      if (kept.length < lines.length) return { items, truncated: true };
    }
    return { items, truncated: read.length > maxRows };
  }

  private dataSource(): FoundationParticipatingOrgsDataSource {
    this.source ??= new FoundationParticipatingOrgsSnowflakeSource();
    return this.source;
  }

  private async filtered(filters: FoundationParticipatingOrgsExportFilters): Promise<FoundationParticipatingOrg[]> {
    const foundation = await this.dataSource().getFoundation(filters.foundationSlug, filters.range);
    if (!foundation) {
      if (filters.projectSlug) throw new ResourceNotFoundError('Project', filters.projectSlug, { operation: 'resolve_foundation_participating_orgs_project' });
      return [];
    }
    this.resolveProject(foundation, filters.projectSlug);
    const rows = (await this.rows(foundation, filters.range, filters.projectSlug)).filter((row) => {
      if (filters.segment === 'members' && !row.isMember) return false;
      if (filters.segment === 'non_members' && row.isMember) return false;
      return matches(row, filters);
    });
    const direction = filters.dir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      // A missing comparison or tier goes last in both directions; the direction only orders the values that exist.
      const missingA = isMissing(a, filters.sort);
      const missingB = isMissing(b, filters.sort);
      if (missingA !== missingB) return missingA ? 1 : -1;
      return (missingA ? 0 : compare(a, b, filters.sort) * direction) || a.name.localeCompare(b.name);
    });
  }

  private resolveProject(foundation: FoundationParticipatingOrgsSourceFoundation, projectSlug?: string): { slug: string; name: string } | null {
    if (!projectSlug) return null;
    const project = foundation.projects.find((candidate) => candidate.slug === projectSlug);
    if (!project) throw new ResourceNotFoundError('Project', projectSlug, { operation: 'resolve_foundation_participating_orgs_project' });
    return project;
  }

  /**
   * The foundation's totals for every company with activity in the range, or that project's figures when scoped to one.
   * Foundation totals come from the source as they are: contributors are already unique across projects, so nothing is summed.
   */
  private async rows(
    foundation: FoundationParticipatingOrgsSourceFoundation,
    range: FoundationParticipatingOrgsRange,
    projectSlug?: string
  ): Promise<FoundationParticipatingOrg[]> {
    if (!projectSlug) return foundation.companies.filter(isActive).map((company) => toRow(company, company));

    const companies = new Map(foundation.companies.map((company) => [company.key, company]));
    const lines = await this.dataSource().getProjectLines(foundation.slug, range, { projectSlug });
    return lines.flatMap((line) => {
      const company = companies.get(line.companyKey);
      return company ? [toRow(company, line)] : [];
    });
  }
}

/** A company listed on the page is one with activity in the range; members without any only count toward the roster. */
function isActive(company: FoundationParticipatingOrgsSourceCompany): boolean {
  return company.commits > 0 || company.contributors > 0;
}

function toRow(
  company: FoundationParticipatingOrgsSourceCompany,
  figures: Pick<FoundationParticipatingOrgsSourceCompany, 'commits' | 'commitsChange' | 'contributors' | 'contributorsChange'>
): FoundationParticipatingOrg {
  return {
    participantKey: company.key,
    accountId: company.accountId,
    name: company.name,
    logoUrl: company.logoUrl,
    isMember: company.isMember,
    membershipTierClass: company.tier,
    otherMemberships: company.otherMemberships,
    projectsInvolved: company.projectsInvolved,
    commits: figures.commits,
    commitsChange: figures.commitsChange,
    contributors: figures.contributors,
    contributorsChange: figures.contributorsChange,
  };
}

/** A company's project lines, busiest first; the share is of the company's foundation commits, which every project's commits are part of. */
function toProjectLines(
  foundation: FoundationParticipatingOrgsSourceFoundation,
  company: FoundationParticipatingOrgsSourceCompany,
  lines: FoundationParticipatingOrgsSourceProjectLine[]
): FoundationParticipatingOrgProjectLine[] {
  const projects = new Map(foundation.projects.map((project) => [project.slug, project]));
  return lines
    .map((line) => ({
      projectSlug: line.projectSlug,
      name: projects.get(line.projectSlug)?.name ?? line.projectSlug,
      maturity: projects.get(line.projectSlug)?.maturity ?? null,
      commits: line.commits,
      commitsChange: line.commitsChange,
      contributors: line.contributors,
      contributorsChange: line.contributorsChange,
      shareOfCompanyCommits: company.commits > 0 ? Math.min(1, line.commits / company.commits) : 0,
    }))
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
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
