// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_MEETUPS_PAGE_SIZE, MAX_MEETUPS_PAGE_SIZE, VALID_MEETUP_SORT_ORDERS, VALID_MEETUP_STATUS_VALUES } from '@lfx-one/shared/constants';
import { GetMyMeetupsOptions, MeetupSortOrder, MeetupStatusFilter } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError } from '../errors';
import { logger } from '../services/logger.service';
import { MeetupsService } from '../services/meetups.service';
import { getEffectiveEmail } from '../utils/auth-helper';

export class MeetupsController {
  private readonly meetupsService = new MeetupsService();

  /**
   * GET /api/meetups
   * Get paginated meetups for the authenticated user
   * Query params: isPast (bool), searchQuery (string), community (string), role (string),
   *               status (registered|not-registered), pageSize (number), offset (number),
   *               sortOrder (ASC|DESC), sortField (string)
   */
  public async getMyMeetups(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_my_meetups', {
      has_query: Object.keys(req.query).length > 0,
    });

    try {
      const userEmail = getEffectiveEmail(req);

      if (!userEmail) {
        throw new AuthenticationError('User authentication required', {
          operation: 'get_my_meetups',
        });
      }

      const options = this.parseMeetupsOptions(req);
      const response = await this.meetupsService.getMyMeetups(req, userEmail, options);

      logger.success(req, 'get_my_meetups', startTime, {
        result_count: response.data.length,
        total: response.total,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/meetups/filters
   * Get distinct global community and role filter options for the My Meetups UI
   */
  public async getMeetupFilters(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_meetup_filters');

    try {
      const userEmail = getEffectiveEmail(req);

      if (!userEmail) {
        throw new AuthenticationError('User authentication required', {
          operation: 'get_meetup_filters',
        });
      }

      const response = await this.meetupsService.getMeetupFilters(req);

      logger.success(req, 'get_meetup_filters', startTime, {
        communities_count: response.communities.length,
        roles_count: response.roles.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  private parseMeetupsOptions(req: Request): GetMyMeetupsOptions {
    const rawPageSize = parseInt(String(req.query['pageSize'] ?? DEFAULT_MEETUPS_PAGE_SIZE), 10);
    const rawOffset = parseInt(String(req.query['offset'] ?? 0), 10);
    const rawSortOrder = String(req.query['sortOrder'] ?? 'ASC').toUpperCase() as MeetupSortOrder;
    const rawIsPast = req.query['isPast'];
    const rawStatus = req.query['status'] ? String(req.query['status']) : undefined;

    const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 && rawPageSize <= MAX_MEETUPS_PAGE_SIZE ? rawPageSize : DEFAULT_MEETUPS_PAGE_SIZE;
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const sortOrder: MeetupSortOrder = VALID_MEETUP_SORT_ORDERS.includes(rawSortOrder) ? rawSortOrder : 'ASC';
    const status = rawStatus && VALID_MEETUP_STATUS_VALUES.has(rawStatus) ? (rawStatus as MeetupStatusFilter) : undefined;

    let isPast: boolean | undefined;
    if (rawIsPast === 'true') {
      isPast = true;
    } else if (rawIsPast === 'false') {
      isPast = false;
    }

    return {
      isPast,
      searchQuery: req.query['searchQuery'] ? String(req.query['searchQuery']).trim() : undefined,
      community: req.query['community'] ? String(req.query['community']) : undefined,
      role: req.query['role'] ? String(req.query['role']) : undefined,
      status,
      sortField: req.query['sortField'] ? String(req.query['sortField']) : undefined,
      pageSize,
      offset,
      sortOrder,
    };
  }
}
