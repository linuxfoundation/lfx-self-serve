// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import {
  DEFAULT_ORG_TRAINING_GROUPS_PAGE_SIZE,
  DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELD,
  DEFAULT_ORG_TRAINING_GROUPS_SORT_ORDER,
  DEFAULT_ORG_TRAINING_TAB_ID,
  MAX_ORG_TRAINING_GROUPS_PAGE_SIZE,
  ORG_TRAINING_FILTER_KEYS,
  ORG_TRAINING_VIEW_QUERY_PARAMS,
  VALID_ORG_TRAINING_GROUPS_SORT_FIELDS,
  VALID_ORG_TRAINING_TAB_IDS,
} from '@lfx-one/shared/constants';
import type {
  OrgTrainingGroupSortField,
  OrgTrainingGroupStatus,
  OrgTrainingStatsQuery,
  OrgTrainingTabId,
  OrgTrainingViewState,
} from '@lfx-one/shared/interfaces';
import { orgTrainingStatsQuery, parseOrgTrainingViewState } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { assertOrgLensRead } from '../helpers/org-lens-read-access.helper';
import { assertWellFormedOrgTrainingFilterValue } from '../helpers/org-training-filter.helper';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { getStringQueryParam, parseOffsetPagination } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { OrgLensTrainingService } from '../services/org-lens-training.service';

/**
 * Range, filters and groupBy of the shared Training / Trainees view; the same allow-list rules as the URL. A filter value that
 * can only be malformed (not one string, over the length cap, or holding a control character other than a tab) is a 400 here, before the URL
 * rules would silently cut it; any other value is the service's to compare with the organization's own values.
 */
function parseViewState(req: Request, operation: string): OrgTrainingViewState {
  for (const filter of ORG_TRAINING_FILTER_KEYS) {
    const param = ORG_TRAINING_VIEW_QUERY_PARAMS[filter];
    const raw = req.query[param];
    if (raw !== undefined) assertWellFormedOrgTrainingFilterValue(raw, param, operation, 'filter');
  }
  return parseOrgTrainingViewState((param) => getStringQueryParam(req, param));
}

function parseTab(req: Request, operation: string): OrgTrainingTabId {
  const raw = getStringQueryParam(req, 'tab');
  if (raw === undefined) return DEFAULT_ORG_TRAINING_TAB_ID;
  if (!VALID_ORG_TRAINING_TAB_IDS.has(raw as OrgTrainingTabId)) {
    throw ServiceValidationError.forField('tab', 'tab query parameter must be "certifications" or "trainings"', { operation });
  }
  return raw as OrgTrainingTabId;
}

/** HTTP boundary for OrgLensTrainingService — validation, lifecycle logging, error propagation. */
export class OrgLensTrainingController {
  private readonly service: OrgLensTrainingService;

  public constructor() {
    this.service = new OrgLensTrainingService();
  }

  /** GET /api/orgs/:orgUid/lens/training/stats?range&foundation&trainingProject&course&level&format */
  public async getTrainingStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const operation = 'get_org_lens_training_stats';
    const startTime = logger.startOperation(req, operation, { org_uid: orgUid });

    try {
      assertOrgUid(orgUid, operation);
      // Memoized per request: the route gate already ran it. The qualification decides whether the shared caches may serve this caller.
      const qualification = await assertOrgLensRead(req, orgUid, operation);

      // Spec 002: orgUid is the canonical org account id (SFID); pass it straight to Snowflake.
      const query: OrgTrainingStatsQuery = orgTrainingStatsQuery(parseViewState(req, operation));
      const response = await this.service.getTrainingStats(orgUid, query, qualification);

      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        time_range: query.range,
        roster_members: response.rosterMembers,
        people_with_training_activity: response.peopleWithTrainingActivity,
        courses_taken: response.coursesTaken,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/training/filter-options?range */
  public async getFilterOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const operation = 'get_org_lens_training_filter_options';
    const startTime = logger.startOperation(req, operation, { org_uid: orgUid });

    try {
      assertOrgUid(orgUid, operation);
      const qualification = await assertOrgLensRead(req, orgUid, operation);

      const { range } = parseViewState(req, operation);
      const response = await this.service.getFilterOptions(orgUid, range, qualification);

      logger.success(req, operation, startTime, { org_uid: orgUid, time_range: range, course_count: response.courses.length });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/training/groups?groupBy&tab&search&sortField&sortOrder&pageSize&offset + stats query */
  public async getGroups(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const operation = 'get_org_lens_training_groups';
    const startTime = logger.startOperation(req, operation, { org_uid: orgUid });

    try {
      assertOrgUid(orgUid, operation);
      const qualification = await assertOrgLensRead(req, orgUid, operation);

      const state = parseViewState(req, operation);
      const tab = parseTab(req, operation);
      const { pageSize, offset } = parseOffsetPagination(req, {
        defaultPageSize: DEFAULT_ORG_TRAINING_GROUPS_PAGE_SIZE,
        maxPageSize: MAX_ORG_TRAINING_GROUPS_PAGE_SIZE,
      });
      const rawSortField = getStringQueryParam(req, 'sortField');
      const sortField = (
        rawSortField && VALID_ORG_TRAINING_GROUPS_SORT_FIELDS.has(rawSortField) ? rawSortField : DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELD
      ) as OrgTrainingGroupSortField;
      const rawSortOrder = String(req.query['sortOrder'] ?? DEFAULT_ORG_TRAINING_GROUPS_SORT_ORDER).toUpperCase();
      const sortOrder = rawSortOrder === 'ASC' ? 'ASC' : 'DESC';

      const response = await this.service.getGroups(
        req,
        orgUid,
        orgTrainingStatsQuery(state),
        {
          groupBy: state.groupBy,
          tab,
          searchQuery: getStringQueryParam(req, 'search'),
          sortField,
          sortOrder,
          pageSize,
          offset,
        },
        qualification
      );

      logger.success(req, operation, startTime, { org_uid: orgUid, group_by: state.groupBy, tab, result_count: response.data.length, total: response.total });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/training/groups/employees?groupBy&groupValue&tab&status + stats query */
  public async getGroupEmployees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const operation = 'get_org_lens_training_group_employees';
    const startTime = logger.startOperation(req, operation, { org_uid: orgUid });

    try {
      assertOrgUid(orgUid, operation);
      const qualification = await assertOrgLensRead(req, orgUid, operation);

      const state = parseViewState(req, operation);
      const tab = parseTab(req, operation);

      // '' is a real value (the group of pairs without the attribute), so only an absent param is rejected.
      const groupValue = getStringQueryParam(req, 'groupValue');
      if (groupValue === undefined) {
        throw ServiceValidationError.forField('groupValue', 'groupValue query parameter is required', { operation });
      }

      const rawStatus = getStringQueryParam(req, 'status');
      if (rawStatus !== 'completed' && rawStatus !== 'in-progress') {
        throw ServiceValidationError.forField('status', 'status query parameter must be "completed" or "in-progress"', { operation });
      }
      const status: OrgTrainingGroupStatus = rawStatus;

      // Malformed is a 400; the service then accepts only a group of the table, so no other string reaches a cache key or SQL.
      assertWellFormedOrgTrainingFilterValue(groupValue, 'groupValue', operation, 'groupKey');
      const response = await this.service.getGroupEmployees(
        req,
        orgUid,
        orgTrainingStatsQuery(state),
        {
          groupBy: state.groupBy,
          groupValue,
          tab,
          status,
        },
        qualification
      );

      logger.success(req, operation, startTime, { org_uid: orgUid, group_by: state.groupBy, tab, status, total: response.total });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}
