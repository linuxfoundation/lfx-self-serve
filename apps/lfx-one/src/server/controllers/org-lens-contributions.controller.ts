// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CONTRIBUTIONS_DEFAULT_PAGE_SIZE,
  CONTRIBUTIONS_MAX_FILTER_VALUES,
  CONTRIBUTIONS_MAX_PAGE_SIZE,
  CONTRIBUTIONS_PAGE_SIZE_OPTIONS,
  MAX_SNOWFLAKE_PAGINATION_PAGE,
  ORG_LENS_DEFAULT_TIME_RANGE,
  ORG_LENS_TIME_RANGES,
} from '@lfx-one/shared/constants';
import type {
  ContributionsCommitSortColumn,
  ContributionsSortColumn,
  ContributionsView,
  OrgContributionsQuery,
  OrgLensTimeRange,
} from '@lfx-one/shared/interfaces';
import { isOrgLensTimeRange, normalizeLegacyOrgLensTimeRange } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { parseOrgCommitFilters } from '../helpers/org-commit-filters.helper';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { clampInteger, getStringQueryParam } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { OrgContributionsService } from '../services/org-contributions.service';

const VALID_SORT_COLUMNS: ReadonlySet<ContributionsSortColumn> = new Set(['commits', 'firstCommit', 'lastCommit']);
const VALID_VIEWS: ReadonlySet<ContributionsView> = new Set(['repositories', 'commits']);
const VALID_COMMIT_SORT_COLUMNS: ReadonlySet<ContributionsCommitSortColumn> = new Set(['project', 'committer', 'username', 'date']);
/** A foundation id is a short project id; anything longer is not one and would only bloat the bind and the cache key. */
const MAX_FOUNDATION_LENGTH = 255;

/** HTTP boundary for the OrgContributionsService (LFXV2-1894) — validation, lifecycle logging, error propagation. */
export class OrgLensContributionsController {
  private readonly service: OrgContributionsService;

  public constructor() {
    this.service = new OrgContributionsService();
  }

  /** GET /api/orgs/:orgUid/lens/contributions — KPI strip + repositories table + filter options, server-paginated. */
  public async getContributions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const operation = 'get_org_lens_contributions';

    try {
      assertOrgUid(orgUid, operation);
      const query = parseContributionsQuery(req, operation);
      const startTime = logger.startOperation(req, operation, {
        org_uid: orgUid,
        view: query.view,
        date_range: query.dateRange,
        project_scope: query.projectScope,
        commit_scope: query.commitScope,
        metric: query.metric,
        foundation_id: query.foundation || null,
        project_count: query.projects.length,
        employee_count: query.employees.length,
        page: query.page,
        size: query.size,
      });

      const response = await this.service.getContributions(orgUid, query);

      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        date_range: query.dateRange,
        repository_count: response.repositories.length,
        total_records: response.totalRecords,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}

/** Parse + validate the composed filter/pagination query: invalid range/sort/commit filters or oversized filter lists → 400; missing values fall back to defaults. */
function parseContributionsQuery(req: Request, operation: string): OrgContributionsQuery {
  const rawRange = getStringQueryParam(req, 'range');
  const dateRange = parseDateRange(rawRange, operation);

  const rawSort = getStringQueryParam(req, 'sort');
  const sort = parseSortColumn(rawSort, operation);

  const rawCommitSort = getStringQueryParam(req, 'commitSort');
  const commitSort = parseCommitSortColumn(rawCommitSort, operation);

  const dir = getStringQueryParam(req, 'dir') === 'asc' ? 1 : -1;
  const commitDir = getStringQueryParam(req, 'commitDir') === 'asc' ? 1 : -1;

  return {
    ...parseOrgCommitFilters(req, operation),
    view: parseView(getStringQueryParam(req, 'view'), operation),
    dateRange,
    search: getStringQueryParam(req, 'q')?.trim() ?? '',
    foundation: parseFoundation(getStringQueryParam(req, 'foundation'), operation),
    projects: parseCsvParam(getStringQueryParam(req, 'projects'), 'projects', operation),
    employees: parseCsvParam(getStringQueryParam(req, 'employees'), 'employees', operation),
    sort,
    dir,
    commitSort,
    commitDir,
    page: clampInteger(Number.parseInt(getStringQueryParam(req, 'page') ?? '', 10), 1, MAX_SNOWFLAKE_PAGINATION_PAGE, 1),
    size: parsePageSize(getStringQueryParam(req, 'size')),
  };
}

/** One foundation id, matched exactly like People → Contributors; missing or blank is any foundation, over 255 chars → 400. */
function parseFoundation(raw: string | undefined, operation: string): string {
  const foundation = raw?.trim() ?? '';
  if (foundation.length > MAX_FOUNDATION_LENGTH) {
    throw ServiceValidationError.forField('foundation', `Invalid foundation value. Maximum length: ${MAX_FOUNDATION_LENGTH}`, { operation });
  }
  return foundation;
}

function parseView(raw: string | undefined, operation: string): ContributionsView {
  if (!raw) {
    return 'repositories';
  }
  if (!VALID_VIEWS.has(raw as ContributionsView)) {
    throw ServiceValidationError.forField('view', `Invalid view value. Allowed: ${[...VALID_VIEWS].join(', ')}`, { operation });
  }
  return raw as ContributionsView;
}

function parseCommitSortColumn(raw: string | undefined, operation: string): ContributionsCommitSortColumn {
  if (!raw) {
    return 'date';
  }
  if (!VALID_COMMIT_SORT_COLUMNS.has(raw as ContributionsCommitSortColumn)) {
    throw ServiceValidationError.forField('commitSort', `Invalid commitSort value. Allowed: ${[...VALID_COMMIT_SORT_COLUMNS].join(', ')}`, { operation });
  }
  return raw as ContributionsCommitSortColumn;
}

/** Missing → the default; the legacy `12mo` → `365d`; any other unknown value → 400. */
function parseDateRange(raw: string | undefined, operation: string): OrgLensTimeRange {
  if (!raw) {
    return ORG_LENS_DEFAULT_TIME_RANGE;
  }
  const range = normalizeLegacyOrgLensTimeRange(raw);
  if (!isOrgLensTimeRange(range)) {
    throw ServiceValidationError.forField('range', `Invalid range value. Allowed: ${ORG_LENS_TIME_RANGES.join(', ')}`, { operation });
  }
  return range;
}

function parseSortColumn(raw: string | undefined, operation: string): ContributionsSortColumn {
  if (!raw) {
    return 'commits';
  }
  if (!VALID_SORT_COLUMNS.has(raw as ContributionsSortColumn)) {
    throw ServiceValidationError.forField('sort', `Invalid sort value. Allowed: ${[...VALID_SORT_COLUMNS].join(', ')}`, { operation });
  }
  return raw as ContributionsSortColumn;
}

/** Split a CSV filter into distinct values; more than CONTRIBUTIONS_MAX_FILTER_VALUES → 400 before any SQL is built. */
function parseCsvParam(raw: string | undefined, field: string, operation: string): string[] {
  if (!raw) {
    return [];
  }
  const values = [
    ...new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    ),
  ];
  if (values.length > CONTRIBUTIONS_MAX_FILTER_VALUES) {
    throw ServiceValidationError.forField(field, `Too many ${field} values. Maximum: ${CONTRIBUTIONS_MAX_FILTER_VALUES}`, { operation });
  }
  return values;
}

function parsePageSize(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (CONTRIBUTIONS_PAGE_SIZE_OPTIONS.includes(parsed)) {
    return parsed;
  }
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= CONTRIBUTIONS_MAX_PAGE_SIZE) {
    return parsed;
  }
  return CONTRIBUTIONS_DEFAULT_PAGE_SIZE;
}
