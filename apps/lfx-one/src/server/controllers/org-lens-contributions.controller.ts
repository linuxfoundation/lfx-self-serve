// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CONTRIBUTIONS_DEFAULT_DATE_RANGE,
  CONTRIBUTIONS_DEFAULT_PAGE_SIZE,
  CONTRIBUTIONS_MAX_PAGE_SIZE,
  CONTRIBUTIONS_PAGE_SIZE_OPTIONS,
} from '@lfx-one/shared/constants';
import type {
  ContributionsCommitSortColumn,
  ContributionsDateRange,
  ContributionsSortColumn,
  ContributionsView,
  OrgContributionsQuery,
} from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { getStringQueryParam } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { OrgContributionsService } from '../services/org-contributions.service';

const VALID_DATE_RANGES: ReadonlySet<ContributionsDateRange> = new Set(['30d', '90d', '12mo', 'all']);
const VALID_SORT_COLUMNS: ReadonlySet<ContributionsSortColumn> = new Set(['commits', 'firstCommit', 'lastCommit']);
const VALID_VIEWS: ReadonlySet<ContributionsView> = new Set(['repositories', 'commits']);
const VALID_COMMIT_SORT_COLUMNS: ReadonlySet<ContributionsCommitSortColumn> = new Set(['project', 'committer', 'username', 'date']);

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

/** Parse + validate the composed filter/pagination query: invalid range/sort → 400; missing values fall back to defaults. */
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
    view: parseView(getStringQueryParam(req, 'view'), operation),
    dateRange,
    search: getStringQueryParam(req, 'q')?.trim() ?? '',
    projects: parseCsvParam(getStringQueryParam(req, 'projects')),
    employees: parseCsvParam(getStringQueryParam(req, 'employees')),
    sort,
    dir,
    commitSort,
    commitDir,
    page: parsePositiveInt(getStringQueryParam(req, 'page'), 1),
    size: parsePageSize(getStringQueryParam(req, 'size')),
  };
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

function parseDateRange(raw: string | undefined, operation: string): ContributionsDateRange {
  if (!raw) {
    return CONTRIBUTIONS_DEFAULT_DATE_RANGE;
  }
  if (!VALID_DATE_RANGES.has(raw as ContributionsDateRange)) {
    throw ServiceValidationError.forField('range', `Invalid range value. Allowed: ${[...VALID_DATE_RANGES].join(', ')}`, { operation });
  }
  return raw as ContributionsDateRange;
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

function parseCsvParam(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
