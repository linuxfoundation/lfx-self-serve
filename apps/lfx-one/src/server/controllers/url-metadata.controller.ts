// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { UrlMetadataRequest } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { MAX_URLS_PER_REQUEST, resolveUrlMetadata } from '../services/url-metadata.service';

/**
 * Controller for resolving URL metadata (titles) from external URLs
 */
export class UrlMetadataController {
  /**
   * POST /api/url-metadata
   * Accepts an array of URLs and returns their resolved titles and domains.
   */
  public async resolveMetadata(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'resolve_url_metadata', {
      url_count: (req.body as UrlMetadataRequest)?.urls?.length,
    });

    try {
      const { urls } = req.body as UrlMetadataRequest;

      if (!Array.isArray(urls) || urls.length === 0) {
        const validationError = ServiceValidationError.forField('urls', 'urls must be a non-empty array of strings', {
          operation: 'resolve_url_metadata',
          service: 'url_metadata_controller',
          path: req.path,
        });

        logger.error(req, 'resolve_url_metadata', startTime, validationError, { reason: 'invalid_urls_array' });
        next(validationError);
        return;
      }

      // Validate that every item is a string
      if (!urls.every((u) => typeof u === 'string')) {
        const validationError = ServiceValidationError.forField('urls', 'Every URL must be a string', {
          operation: 'resolve_url_metadata',
          service: 'url_metadata_controller',
          path: req.path,
        });

        logger.error(req, 'resolve_url_metadata', startTime, validationError, { reason: 'non_string_urls' });
        next(validationError);
        return;
      }

      // Deduplicate URLs to prevent amplification
      const uniqueUrls = [...new Set(urls)];

      if (uniqueUrls.length > MAX_URLS_PER_REQUEST) {
        const validationError = ServiceValidationError.forField('urls', `Maximum ${MAX_URLS_PER_REQUEST} unique URLs per request`, {
          operation: 'resolve_url_metadata',
          service: 'url_metadata_controller',
          path: req.path,
        });

        logger.error(req, 'resolve_url_metadata', startTime, validationError, { reason: 'too_many_urls', count: uniqueUrls.length });
        next(validationError);
        return;
      }

      const results = await resolveUrlMetadata(req, uniqueUrls);

      logger.success(req, 'resolve_url_metadata', startTime, {
        total: results.length,
        with_titles: results.filter((r) => r.title).length,
      });

      res.json({ results });
    } catch (error) {
      logger.error(req, 'resolve_url_metadata', startTime, error, {});
      next(error);
    }
  }
}
