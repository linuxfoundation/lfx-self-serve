// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MEMBERSHIP_TIER_ORDER,
  ORG_ACCOUNT_ID_PATTERN,
  PROJECT_PARTICIPATING_ORGS_CONTRIBUTION_FILTERS,
  PROJECT_PARTICIPATING_ORGS_DEFAULT_RANGE,
  PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT,
  PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT_DIR,
  PROJECT_PARTICIPATING_ORGS_EXPORT_CSV_HEADER,
  PROJECT_PARTICIPATING_ORGS_EXPORT_TRUNCATED_HEADER,
  PROJECT_PARTICIPATING_ORGS_LINKS_ACCOUNT_IDS_PARAM,
  PROJECT_PARTICIPATING_ORGS_MAX_PAGE_SIZE,
  PROJECT_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH,
  PROJECT_PARTICIPATING_ORGS_PAGE_SIZE,
  PROJECT_PARTICIPATING_ORGS_RANGES,
  PROJECT_PARTICIPATING_ORGS_SEGMENTS,
  PROJECT_PARTICIPATING_ORGS_SORT_DIRECTIONS,
  PROJECT_PARTICIPATING_ORGS_SORT_FIELDS,
} from '@lfx-one/shared/constants';
import { rowsToCsv } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { contentDispositionAttachment } from '../helpers/content-disposition.helper';
import { getStrictStringQueryParam } from '../helpers/strict-query-param.helper';
import { parseOffsetPagination } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { ProjectParticipatingOrgsService } from '../services/project-participating-orgs.service';

import type { MembershipTierClass, ProjectParticipatingOrgsExportFilters, ProjectParticipatingOrgsRange } from '@lfx-one/shared/interfaces';

/**
 * Project Lens → Participating Organizations. Every route runs behind
 * `requireProjectParticipatingOrgsAccess` (flag, slug, project#viewer), so `:slug` is already valid here.
 */
export class ProjectParticipatingOrgsController {
  private readonly service = new ProjectParticipatingOrgsService();

  // GET /api/projects/:slug/participating-orgs/summary?range
  public async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_project_participating_orgs_summary';
    const startTime = logger.startOperation(req, operation);

    try {
      const slug = req.params['slug'];
      const range = parseRange(req, operation);
      const summary = await this.service.getSummary(req, slug, range);

      logger.success(req, operation, startTime, { slug, range, has_summary: summary !== null });
      res.json({ summary });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/projects/:slug/participating-orgs?range&segment&search&tier&sort&dir&pageSize&offset
  public async getList(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_project_participating_orgs';
    const startTime = logger.startOperation(req, operation);

    try {
      const slug = req.params['slug'];
      const filters = parseFilters(req, operation);
      const { pageSize, offset } = parseOffsetPagination(req, {
        defaultPageSize: PROJECT_PARTICIPATING_ORGS_PAGE_SIZE,
        maxPageSize: PROJECT_PARTICIPATING_ORGS_MAX_PAGE_SIZE,
      });
      const page = await this.service.getPage(req, slug, { ...filters, pageSize, offset });

      logger.success(req, operation, startTime, {
        slug,
        range: filters.range,
        segment: filters.segment,
        tier: filters.tier,
        contribution: filters.contribution ?? 'all',
        sort: filters.sort,
        dir: filters.dir,
        has_search: !!filters.search,
        page_size: pageSize,
        offset,
        result_count: page.rows.length,
        total: page.totalRecords,
      });
      res.json(page);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/projects/:slug/participating-orgs/org-lens-links?accountIds=a,b -> { readableAccountIds }, per caller
  public async getOrgLensLinks(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_project_participating_orgs_org_lens_links';
    const startTime = logger.startOperation(req, operation);

    try {
      const accountIds = parseAccountIds(req, operation);
      const readableAccountIds = await this.service.getOrgLensReadableAccountIds(req, accountIds);

      logger.success(req, operation, startTime, { slug: req.params['slug'], requested: accountIds.length, readable: readableAccountIds.length });
      // Per-caller answer: never let a shared cache keep it.
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ readableAccountIds });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/projects/:slug/participating-orgs/export?range&segment&search&tier&sort&dir -> text/csv attachment, or 204 when nothing matches
  public async export(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'export_project_participating_orgs';
    const startTime = logger.startOperation(req, operation);

    try {
      const slug = req.params['slug'];
      const filters = parseFilters(req, operation);
      const { rows, truncated } = await this.service.getExportRows(req, slug, filters);

      logger.success(req, operation, startTime, { slug, range: filters.range, segment: filters.segment, result_count: rows.length, truncated });
      res.setHeader('Cache-Control', 'private, no-store');
      if (rows.length === 0) {
        res.status(204).end();
        return;
      }

      const csv = rowsToCsv([
        [...PROJECT_PARTICIPATING_ORGS_EXPORT_CSV_HEADER],
        ...rows.map((row) => [
          row.name,
          row.isMember ? 'Member' : 'Non-Member',
          row.membershipTierClass ?? '',
          row.isUnidentified ? 'Yes' : 'No',
          row.commits,
          row.commitsPrev ?? '',
          row.contributors,
          row.contributorsPrev ?? '',
        ]),
      ]);
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', contentDispositionAttachment(`participating-orgs-${slug}-${filters.range}-${date}.csv`));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (truncated) res.setHeader(PROJECT_PARTICIPATING_ORGS_EXPORT_TRUNCATED_HEADER, 'true');
      // The byte order mark lets Excel read company names as UTF-8.
      res.send(`\ufeff${csv}`);
    } catch (error) {
      next(error);
    }
  }
}

/** Reads `name` against an allowlist; absent → `fallback`, anything else → 400 on that field. */
function parseEnum<T extends string>(req: Request, name: string, allowed: readonly T[], fallback: T, operation: string): T {
  const value = getStrictStringQueryParam(req, name, operation);
  if (value === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    throw ServiceValidationError.forField(name, `${name} must be one of: ${allowed.join(', ')}`, { operation });
  }
  return value as T;
}

function parseRange(req: Request, operation: string): ProjectParticipatingOrgsRange {
  return parseEnum(req, 'range', PROJECT_PARTICIPATING_ORGS_RANGES, PROJECT_PARTICIPATING_ORGS_DEFAULT_RANGE, operation);
}

function parseFilters(req: Request, operation: string): ProjectParticipatingOrgsExportFilters {
  const search = getStrictStringQueryParam(req, 'search', operation)?.trim();
  if (search && search.length > PROJECT_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH) {
    throw ServiceValidationError.forField('search', `search must be at most ${PROJECT_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH} characters`, { operation });
  }

  const tierParam = getStrictStringQueryParam(req, 'tier', operation);
  let tier: MembershipTierClass | undefined;
  if (tierParam) {
    if (!(MEMBERSHIP_TIER_ORDER as readonly string[]).includes(tierParam)) {
      throw ServiceValidationError.forField('tier', 'tier must be a membership tier class', { operation });
    }
    tier = tierParam as MembershipTierClass;
  }
  const contribution = parseEnum(req, 'contribution', PROJECT_PARTICIPATING_ORGS_CONTRIBUTION_FILTERS, 'all', operation);

  return {
    range: parseRange(req, operation),
    segment: parseEnum(req, 'segment', PROJECT_PARTICIPATING_ORGS_SEGMENTS, 'all', operation),
    sort: parseEnum(req, 'sort', PROJECT_PARTICIPATING_ORGS_SORT_FIELDS, PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT, operation),
    dir: parseEnum(req, 'dir', PROJECT_PARTICIPATING_ORGS_SORT_DIRECTIONS, PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT_DIR, operation),
    ...(search ? { search } : {}),
    ...(tier ? { tier } : {}),
    ...(contribution !== 'all' ? { contribution } : {}),
  };
}

/** The member account ids of one shown page: comma-separated canonical ids, deduplicated, at most one max-size page. */
function parseAccountIds(req: Request, operation: string): string[] {
  const name = PROJECT_PARTICIPATING_ORGS_LINKS_ACCOUNT_IDS_PARAM;
  const value = getStrictStringQueryParam(req, name, operation);
  if (!value) throw ServiceValidationError.forField(name, `${name} is required`, { operation });

  const accountIds = [...new Set(value.split(',').map((id) => id.trim()))];
  if (accountIds.length > PROJECT_PARTICIPATING_ORGS_MAX_PAGE_SIZE) {
    throw ServiceValidationError.forField(name, `${name} must list at most ${PROJECT_PARTICIPATING_ORGS_MAX_PAGE_SIZE} ids`, { operation });
  }
  if (accountIds.some((id) => !ORG_ACCOUNT_ID_PATTERN.test(id))) {
    throw ServiceValidationError.forField(name, `${name} must be canonical organization account ids`, { operation });
  }
  return accountIds;
}
