// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeOrganizationReference, UserSearchParams } from '@lfx-one/shared/interfaces';
import { currentEmployerFromWorkExperiences } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { CdpService } from '../services/cdp.service';
import { SearchService } from '../services/search.service';

/**
 * Controller for handling search HTTP requests
 */
export class SearchController {
  private searchService: SearchService = new SearchService();
  private cdpService: CdpService = new CdpService();

  /**
   * GET /search/users
   * Searches for users across meeting registrants and committee members
   */
  public async searchUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { name, type, tags } = req.query;
    const startTime = logger.startOperation(req, 'search_users', {
      has_name: !!name,
      has_type: !!type,
      has_tags: !!tags,
    });

    try {
      // Validate required parameters
      if ((!name || typeof name !== 'string') && (!tags || typeof tags !== 'string')) {
        const validationError = ServiceValidationError.forField('name', 'Name or tags parameter is required and must be a string', {
          operation: 'search_users',
          service: 'search_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      if (!type || typeof type !== 'string') {
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
      };

      // Perform the search
      const results = await this.searchService.searchUsers(req, searchParams);

      logger.success(req, 'search_users', startTime, {
        result_count: results.results.length,
        has_more: results.has_more,
      });

      res.json(results);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /search/users/:lfid/work-experiences
   * Returns the computed current employer ({name, id}) for any user by LFID, or null.
   * Used to pre-fill the organization field in the add-member dialog.
   *
   * Auth: requires a valid session (authMiddleware, applied globally). Any authenticated user can
   * query any LFID — a committee-admin role guard is not yet implemented in this BFF. The response
   * is a single computed org reference (no employment dates or job titles) to limit PII exposure.
   * TODO(LFXV2-2531): add a committee-admin/manager role check once the BFF has that middleware.
   */
  public async getUserWorkExperiences(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { lfid } = req.params;
    const startTime = logger.startOperation(req, 'get_user_work_experiences', { lfid });

    try {
      if (!lfid || typeof lfid !== 'string') {
        return next(
          ServiceValidationError.forField('lfid', 'lfid path parameter is required', {
            operation: 'get_user_work_experiences',
            service: 'search_controller',
            path: req.path,
          })
        );
      }

      const workExperiences = await this.cdpService.getWorkExperiencesForUser(req, lfid);
      const employer: CommitteeOrganizationReference | null = currentEmployerFromWorkExperiences(workExperiences);

      logger.success(req, 'get_user_work_experiences', startTime, { lfid, found: !!employer });

      res.json(employer);
    } catch (error) {
      next(error);
    }
  }
}
