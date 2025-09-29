// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { Logger } from '../helpers/logger';
import { OrganizationService } from '../services/organization.service';

/**
 * Controller for handling organization HTTP requests
 */
export class OrganizationController {
  private organizationService: OrganizationService = new OrganizationService();

  /**
   * GET /organizations/search
   */
  public async searchOrganizations(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { query } = req.query;
    const startTime = Logger.start(req, 'search_organizations', {
      has_query: !!query,
    });

    try {
      // Check if the search query is provided and is a string
      if (!query || typeof query !== 'string') {
        Logger.error(req, 'search_organizations', startTime, new Error('Missing or invalid search query'), {
          query_type: typeof query,
        });

        // Create a validation error
        const validationError = ServiceValidationError.forField('query', 'Search query is required and must be a string', {
          operation: 'search_organizations',
          service: 'organization_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Search for organizations
      const suggestions = await this.organizationService.searchOrganizations(req, query);

      // Log the success
      Logger.success(req, 'search_organizations', startTime, {
        result_count: suggestions.length,
      });

      // Send the results to the client
      res.json({ suggestions });
    } catch (error) {
      // Log the error
      Logger.error(req, 'search_organizations', startTime, error);
      next(error);
    }
  }
}
