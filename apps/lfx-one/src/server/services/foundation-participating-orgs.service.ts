// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_PARTICIPATING_ORGS_EXPORT_MAX_ROWS, MEMBERSHIP_TIER_ORDER } from '@lfx-one/shared/constants';
import type {
  FoundationParticipatingOrg,
  FoundationParticipatingOrgBreakdown,
  FoundationParticipatingOrgProjectLine,
  FoundationParticipatingOrgsExportFilters,
  FoundationParticipatingOrgsPage,
  FoundationParticipatingOrgsProject,
  FoundationParticipatingOrgsQuery,
  FoundationParticipatingOrgsRange,
  FoundationParticipatingOrgsSummary,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { logger } from './logger.service';
import { DemoCompany, DemoFoundation, getDemoFoundation } from './foundation-participating-orgs.demo-data';

const RANGE_SCALE: Record<FoundationParticipatingOrgsRange, number> = { '12mo': 1, '6mo': 0.55, '90d': 0.28, all: 2.4 };

/** One company as the data source reports it for a foundation, range and (optional) project scope. */
export interface FoundationCompanyActivity {
  company: DemoCompany;
  row: FoundationParticipatingOrg;
  /** Every project the company is active in for the range, sorted by commits. */
  lines: FoundationParticipatingOrgProjectLine[];
}

/**
 * Seam between the BFF and the warehouse. Today it is backed by the fictional demo foundation (#5707); the
 * warehouse-backed source must return the same shapes with foundation totals summed from project activity and
 * contributors de-duplicated across projects.
 */
export interface FoundationParticipatingOrgsDataSource {
  getFoundation(slug: string): DemoFoundation;
}

const demoSource: FoundationParticipatingOrgsDataSource = { getFoundation: getDemoFoundation };

export class FoundationParticipatingOrgsService {
  public constructor(private readonly source: FoundationParticipatingOrgsDataSource = demoSource) {}

  public getProjects(req: Request, slug: string, range: FoundationParticipatingOrgsRange): FoundationParticipatingOrgsProject[] {
    logger.debug(req, 'get_foundation_participating_orgs_projects', 'Building project scope list', { slug, range });
    const foundation = this.source.getFoundation(slug);
    const scale = RANGE_SCALE[range];
    return foundation.projects
      .map((project) => ({
        slug: project.slug,
        name: project.name,
        maturity: project.maturity,
        commits: Math.round(
          foundation.companies
            .flatMap((company) => company.projects)
            .filter((p) => p.projectSlug === project.slug)
            .reduce((sum, p) => sum + p.commits, 0) * scale
        ),
      }))
      .sort((a, b) => b.commits - a.commits);
  }

  public getSummary(req: Request, slug: string, range: FoundationParticipatingOrgsRange, projectSlug?: string): FoundationParticipatingOrgsSummary | null {
    logger.debug(req, 'get_foundation_participating_orgs_summary', 'Building summary', { slug, range, project_slug: projectSlug });
    const foundation = this.source.getFoundation(slug);
    const project = this.resolveProject(foundation, projectSlug);
    const activity = this.activities(foundation, range, projectSlug);
    if (activity.length === 0) return null;

    const members = activity.filter((item) => item.row.isMember);
    const commits = activity.reduce((sum, item) => sum + item.row.commits, 0);
    const memberCommits = members.reduce((sum, item) => sum + item.row.commits, 0);
    return {
      foundationSlug: slug,
      foundationName: foundation.name,
      projectCount: foundation.projects.length,
      projectSlug: project?.slug ?? null,
      projectName: project?.name ?? null,
      range,
      asOfDate: new Date().toISOString().slice(0, 10),
      companiesCount: activity.length,
      membersCount: foundation.companies.filter((company) => company.tier !== null).length,
      contributingMembersCount: members.length,
      nonMembersCount: activity.length - members.length,
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
    const item = this.activities(foundation, range).find((candidate) => candidate.row.participantKey === companyKey);
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

  public getExportRows(req: Request, filters: FoundationParticipatingOrgsExportFilters): { items: FoundationCompanyActivity[]; truncated: boolean } {
    logger.debug(req, 'export_foundation_participating_orgs', 'Building export rows', { slug: filters.foundationSlug });
    const items = this.filtered(filters);
    return { items: items.slice(0, FOUNDATION_PARTICIPATING_ORGS_EXPORT_MAX_ROWS), truncated: items.length > FOUNDATION_PARTICIPATING_ORGS_EXPORT_MAX_ROWS };
  }

  private filtered(filters: FoundationParticipatingOrgsExportFilters): FoundationCompanyActivity[] {
    const foundation = this.source.getFoundation(filters.foundationSlug);
    this.resolveProject(foundation, filters.projectSlug);
    const search = filters.search?.toLowerCase();
    const items = this.activities(foundation, filters.range, filters.projectSlug).filter(({ row }) => {
      if (filters.segment === 'members' && !row.isMember) return false;
      if (filters.segment === 'non_members' && row.isMember) return false;
      if (filters.tier && row.membershipTierClass !== filters.tier) return false;
      return !search || row.name.toLowerCase().includes(search);
    });
    return items.sort((a, b) => compare(a.row, b.row, filters.sort) * (filters.dir === 'asc' ? 1 : -1) || a.row.name.localeCompare(b.row.name));
  }

  private resolveProject(foundation: DemoFoundation, projectSlug?: string): { slug: string; name: string } | null {
    if (!projectSlug) return null;
    const project = foundation.projects.find((candidate) => candidate.slug === projectSlug);
    if (!project) throw new ResourceNotFoundError('Project', projectSlug, { operation: 'resolve_foundation_participating_orgs_project' });
    return project;
  }

  /** Foundation totals for every company with activity in the range, or that project's figures when scoped to one. */
  private activities(foundation: DemoFoundation, range: FoundationParticipatingOrgsRange, projectSlug?: string): FoundationCompanyActivity[] {
    const scale = RANGE_SCALE[range];
    const names = new Map(foundation.projects.map((project) => [project.slug, project]));
    const items: FoundationCompanyActivity[] = [];

    for (const company of foundation.companies) {
      const scoped = projectSlug ? company.projects.filter((project) => project.projectSlug === projectSlug) : company.projects;
      if (scoped.length === 0) continue;

      const totalCommits = Math.max(1, Math.round(company.projects.reduce((sum, project) => sum + project.commits, 0) * scale));
      const lines = company.projects
        .map((project) => ({
          projectSlug: project.projectSlug,
          name: names.get(project.projectSlug)?.name ?? project.projectSlug,
          maturity: names.get(project.projectSlug)?.maturity ?? null,
          commits: Math.max(1, Math.round(project.commits * scale)),
          commitsChange: range === 'all' ? null : project.commitsChange,
          contributors: project.contributors,
          contributorsChange: range === 'all' ? null : project.contributorsChange,
          shareOfCompanyCommits: Math.min(1, Math.max(1, Math.round(project.commits * scale)) / totalCommits),
        }))
        .sort((a, b) => b.commits - a.commits);

      const commits = scoped.reduce((sum, project) => sum + Math.max(1, Math.round(project.commits * scale)), 0);
      const single = projectSlug ? scoped[0] : null;
      const weighted =
        scoped.reduce((sum, project) => sum + (project.commitsChange ?? 0) * project.commits, 0) / scoped.reduce((sum, project) => sum + project.commits, 0);
      const foundationChange = Math.round(weighted * 100) / 100;
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
      items.push({ company, row, lines });
    }
    return items;
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
      return (a.commitsChange ?? -Infinity) - (b.commitsChange ?? -Infinity);
    case 'contributors':
      return a.contributors - b.contributors;
    case 'contributors_change':
      return (a.contributorsChange ?? -Infinity) - (b.contributorsChange ?? -Infinity);
  }
}

/** Platinum first; non-members last. */
function tierRank(row: FoundationParticipatingOrg): number {
  if (!row.membershipTierClass) return MEMBERSHIP_TIER_ORDER.length + 1;
  const index = (MEMBERSHIP_TIER_ORDER as readonly string[]).indexOf(row.membershipTierClass);
  return index === -1 ? MEMBERSHIP_TIER_ORDER.length : index;
}
