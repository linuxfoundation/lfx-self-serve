// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { UserSearchParams } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { Logger } from '../helpers/logger';
import { SearchService } from '../services/search.service';

/**
 * Controller for handling search HTTP requests
 */
export class SearchController {
  private searchService: SearchService = new SearchService();

  /**
   * GET /search/users
   * Searches for users across meeting registrants and committee members
   */
  public async searchUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { name, type, tags } = req.query;
    const startTime = Logger.start(req, 'search_users', {
      has_name: !!name,
      has_type: !!type,
      has_tags: !!tags,
    });

    try {
      // Validate required parameters
      if ((!name || typeof name !== 'string') && (!tags || typeof tags !== 'string')) {
        Logger.error(req, 'search_users', startTime, new Error('Missing or invalid name parameter'), {
          name_type: typeof name,
          tags_type: typeof tags,
        });

        const validationError = ServiceValidationError.forField('name', 'Name or tags parameter is required and must be a string', {
          operation: 'search_users',
          service: 'search_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      if (!type || typeof type !== 'string') {
        Logger.error(req, 'search_users', startTime, new Error('Missing or invalid type parameter'), {
          type_type: typeof type,
        });

        const validationError = ServiceValidationError.forField('type', 'Type parameter is required and must be a string', {
          operation: 'search_users',
          service: 'search_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Validate type value
      if (!['committee_member', 'meeting_registrant'].includes(type)) {
        Logger.error(req, 'search_users', startTime, new Error('Invalid type value'), {
          provided_type: type,
        });

        const validationError = ServiceValidationError.forField('type', 'Type must be either "committee_member" or "meeting_registrant"', {
          operation: 'search_users',
          service: 'search_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Build search parameters
      const searchParams: UserSearchParams = {
        ...(name ? { name: name as string } : {}),
        ...(tags ? { tags: tags as string } : {}),
        type: type as 'committee_member' | 'meeting_registrant',
        limit: req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : undefined,
        offset: req.query['offset'] ? parseInt(req.query['offset'] as string, 10) : undefined,
      };

      // Perform the search
      const results = await this.searchService.searchUsers(req, searchParams);

      Logger.success(req, 'search_users', startTime, {
        result_count: results.results.length,
        has_more: results.has_more,
      });

      res.json(results);
    } catch (error) {
      Logger.error(req, 'search_users', startTime, error, {
        name,
        tags,
        type,
      });
      next(error);
    }
  }
}
