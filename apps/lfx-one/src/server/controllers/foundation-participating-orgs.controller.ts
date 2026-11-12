// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FOUNDATION_PARTICIPATING_ORGS_DEFAULT_RANGE,
  FOUNDATION_PARTICIPATING_ORGS_EXPORT_BY_PROJECT_HEADER,
  FOUNDATION_PARTICIPATING_ORGS_EXPORT_KINDS,
  FOUNDATION_PARTICIPATING_ORGS_EXPORT_SUMMARY_HEADER,
  FOUNDATION_PARTICIPATING_ORGS_EXPORT_TRUNCATED_HEADER,
  FOUNDATION_PARTICIPATING_ORGS_MAX_PAGE_SIZE,
  FOUNDATION_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH,
  FOUNDATION_PARTICIPATING_ORGS_PAGE_SIZE,
  FOUNDATION_PARTICIPATING_ORGS_RANGES,
  FOUNDATION_PARTICIPATING_ORGS_SLUG_PATTERN,
  MEMBERSHIP_TIER_ORDER,
  PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT,
  PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT_DIR,
  PROJECT_PARTICIPATING_ORGS_SEGMENTS,
  PROJECT_PARTICIPATING_ORGS_SORT_DIRECTIONS,
  PROJECT_PARTICIPATING_ORGS_SORT_FIELDS,
} from '@lfx-one/shared/constants';
import type { FoundationParticipatingOrgsExportFilters, FoundationParticipatingOrgsRange, MembershipTierClass } from '@lfx-one/shared/interfaces';
import { rowsToCsv } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { contentDispositionAttachment } from '../helpers/content-disposition.helper';
import { getStrictStringQueryParam } from '../helpers/strict-query-param.helper';
import { parseOffsetPagination } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { FoundationParticipatingOrgsService } from '../services/foundation-participating-orgs.service';

/**
 * Foundation Lens → Participating Companies (#5697). Every route runs behind `requireDashboardAccess` (executive
 * director of the foundation, or LF staff — the same policy as Health Metrics), which only scopes a request that
 * names `foundationSlug`; so each handler requires it, and the client always sends it.
 */
export class FoundationParticipatingOrgsController {
  private readonly service = new FoundationParticipatingOrgsService();

  // GET /api/foundation-participating-orgs/projects?foundationSlug&range
  public async getProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_foundation_participating_orgs_projects';
    const startTime = logger.startOperation(req, operation);
    try {
      const slug = parseSlug(req, operation);
      const projects = this.service.getProjects(req, slug, parseRange(req, operation));
      logger.success(req, operation, startTime, { slug, count: projects.length });
      res.json({ projects });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/foundation-participating-orgs/summary?foundationSlug&range&projectSlug
  public async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_foundation_participating_orgs_summary';
    const startTime = logger.startOperation(req, operation);
    try {
      const slug = parseSlug(req, operation);
      const range = parseRange(req, operation);
      const summary = this.service.getSummary(req, slug, range, parseProjectSlug(req, operation));
      logger.success(req, operation, startTime, { slug, range, has_summary: summary !== null });
      res.json({ summary });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/foundation-participating-orgs?foundationSlug&range&segment&projectSlug&search&tier&sort&dir&pageSize&offset
  public async getList(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_foundation_participating_orgs';
    const startTime = logger.startOperation(req, operation);
    try {
      const filters = parseFilters(req, operation);
      const { pageSize, offset } = parseOffsetPagination(req, {
        defaultPageSize: FOUNDATION_PARTICIPATING_ORGS_PAGE_SIZE,
        maxPageSize: FOUNDATION_PARTICIPATING_ORGS_MAX_PAGE_SIZE,
      });
      const page = this.service.getPage(req, { ...filters, pageSize, offset });
      logger.success(req, operation, startTime, {
        slug: filters.foundationSlug,
        segment: filters.segment,
        result_count: page.rows.length,
        total: page.totalRecords,
      });
      res.json(page);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/foundation-participating-orgs/breakdown?foundationSlug&range&companyKey
  public async getBreakdown(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_foundation_participating_orgs_breakdown';
    const startTime = logger.startOperation(req, operation);
    try {
      const slug = parseSlug(req, operation);
      const companyKey = getStrictStringQueryParam(req, 'companyKey', operation);
      if (!companyKey || companyKey.length > 200) {
        throw ServiceValidationError.forField('companyKey', 'companyKey is required', { operation });
      }
      const breakdown = this.service.getBreakdown(req, slug, parseRange(req, operation), companyKey);
      logger.success(req, operation, startTime, { slug, project_count: breakdown.projects.length });
      res.json(breakdown);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/foundation-participating-orgs/export?kind=summary|by-project&<list filters> -> text/csv, or 204 when nothing matches
  public async export(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'export_foundation_participating_orgs';
    const startTime = logger.startOperation(req, operation);
    try {
      const filters = parseFilters(req, operation);
      const kind = parseEnum(req, 'kind', FOUNDATION_PARTICIPATING_ORGS_EXPORT_KINDS, 'summary', operation);
      const { items, truncated } = this.service.getExportRows(req, filters);
      logger.success(req, operation, startTime, { slug: filters.foundationSlug, kind, result_count: items.length, truncated });
      res.setHeader('Cache-Control', 'private, no-store');
      if (items.length === 0) {
        res.status(204).end();
        return;
      }

      const rows =
        kind === 'summary'
          ? [
              [...FOUNDATION_PARTICIPATING_ORGS_EXPORT_SUMMARY_HEADER],
              ...items.map(({ row }) => [
                row.name,
                row.isMember ? 'Member' : 'Non-Member',
                row.membershipTierClass ?? '',
                row.otherMemberships.join('; '),
                row.projectsInvolved,
                row.commits,
                '',
                row.contributors,
                '',
              ]),
            ]
          : [
              [...FOUNDATION_PARTICIPATING_ORGS_EXPORT_BY_PROJECT_HEADER],
              // Every project for every company, not just the top 10 the page shows.
              ...items.flatMap(({ row, lines }) =>
                lines.map((line) => [
                  row.name,
                  row.isMember ? 'Member' : 'Non-Member',
                  row.membershipTierClass ?? '',
                  line.name,
                  line.maturity ?? '',
                  line.commits,
                  line.contributors,
                  `${Math.round(line.shareOfCompanyCommits * 100)}%`,
                ])
              ),
            ];
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        contentDispositionAttachment(`participating-companies-${filters.foundationSlug}-${kind}-${filters.range}-${date}.csv`)
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (truncated) res.setHeader(FOUNDATION_PARTICIPATING_ORGS_EXPORT_TRUNCATED_HEADER, 'true');
      // The byte order mark lets Excel read company names as UTF-8.
      res.send(`\ufeff${rowsToCsv(rows)}`);
    } catch (error) {
      next(error);
    }
  }
}

function parseEnum<T extends string>(req: Request, name: string, allowed: readonly T[], fallback: T, operation: string): T {
  const value = getStrictStringQueryParam(req, name, operation);
  if (value === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    throw ServiceValidationError.forField(name, `${name} must be one of: ${allowed.join(', ')}`, { operation });
  }
  return value as T;
}

function parseSlugParam(req: Request, name: string, operation: string): string | undefined {
  const value = getStrictStringQueryParam(req, name, operation)?.toLowerCase();
  if (value === undefined) return undefined;
  if (!FOUNDATION_PARTICIPATING_ORGS_SLUG_PATTERN.test(value)) {
    throw ServiceValidationError.forField(name, `${name} is not a valid slug`, { operation });
  }
  return value;
}

/** The access middleware only scopes a request that names the foundation, so a request without it is refused here. */
function parseSlug(req: Request, operation: string): string {
  const slug = parseSlugParam(req, 'foundationSlug', operation);
  if (!slug) throw ServiceValidationError.forField('foundationSlug', 'foundationSlug is required', { operation });
  return slug;
}

function parseProjectSlug(req: Request, operation: string): string | undefined {
  return parseSlugParam(req, 'projectSlug', operation);
}

function parseRange(req: Request, operation: string): FoundationParticipatingOrgsRange {
  return parseEnum(req, 'range', FOUNDATION_PARTICIPATING_ORGS_RANGES, FOUNDATION_PARTICIPATING_ORGS_DEFAULT_RANGE, operation);
}

function parseFilters(req: Request, operation: string): FoundationParticipatingOrgsExportFilters {
  const search = getStrictStringQueryParam(req, 'search', operation)?.trim();
  if (search && search.length > FOUNDATION_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH) {
    throw ServiceValidationError.forField('search', `search must be at most ${FOUNDATION_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH} characters`, { operation });
  }

  const tierParam = getStrictStringQueryParam(req, 'tier', operation);
  let tier: MembershipTierClass | undefined;
  if (tierParam) {
    if (!(MEMBERSHIP_TIER_ORDER as readonly string[]).includes(tierParam)) {
      throw ServiceValidationError.forField('tier', 'tier must be a membership tier class', { operation });
    }
    tier = tierParam as MembershipTierClass;
  }
  const projectSlug = parseProjectSlug(req, operation);

  return {
    foundationSlug: parseSlug(req, operation),
    range: parseRange(req, operation),
    segment: parseEnum(req, 'segment', PROJECT_PARTICIPATING_ORGS_SEGMENTS, 'all', operation),
    sort: parseEnum(req, 'sort', PROJECT_PARTICIPATING_ORGS_SORT_FIELDS, PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT, operation),
    dir: parseEnum(req, 'dir', PROJECT_PARTICIPATING_ORGS_SORT_DIRECTIONS, PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT_DIR, operation),
    ...(projectSlug ? { projectSlug } : {}),
    ...(search ? { search } : {}),
    ...(tier ? { tier } : {}),
  };
}
