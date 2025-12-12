// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HTTP_HEADERS } from '@lfx-one/shared/constants';
import { ETagError, ETagResult } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Service for handling ETag-based operations with microservices
 */
export class ETagService {
  private microserviceProxy: MicroserviceProxyService = new MicroserviceProxyService();

  /**
   * Fetches a resource with ETag header for safe operations
   */
  public async fetchWithETag<T>(req: Request, service: 'LFX_V2_SERVICE', path: string, operation: string): Promise<ETagResult<T>> {
    logger.debug(req, operation, 'Fetching resource with ETag', { step: 'fetch_with_etag', path });

    const response = await this.microserviceProxy.proxyRequestWithResponse<T>(req, service, path, 'GET');

    if (!response.data) {
      const error = new Error('Resource not found') as Error & ETagError;
      error.code = 'NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }

    const etag = response.headers[HTTP_HEADERS.ETAG.toLowerCase()] || response.headers[HTTP_HEADERS.ETAG];

    if (!etag) {
      logger.warning(req, operation, 'ETag header not found in response', {
        path,
        available_headers: Object.keys(response.headers),
      });

      const error = new Error('Unable to obtain ETag header for safe operation') as Error & ETagError;
      error.code = 'ETAG_MISSING';
      error.statusCode = 500;
      error.headers = response.headers;
      throw error;
    }

    logger.debug(req, operation, 'Resource fetched successfully with ETag', {
      step: 'resource_fetched',
      path,
      has_etag: true,
    });

    return {
      data: response.data,
      etag,
      headers: response.headers,
    };
  }

  /**
   * Performs a safe update operation using If-Match header
   */
  public async updateWithETag<T>(req: Request, service: 'LFX_V2_SERVICE', path: string, etag: string, data: any, operation: string): Promise<T> {
    logger.debug(req, operation, 'Updating resource with ETag', { step: 'update_with_etag', path, has_etag: !!etag });

    return await this.microserviceProxy.proxyRequest<T>(req, service, path, 'PUT', {}, data, { [HTTP_HEADERS.IF_MATCH]: etag });
  }

  /**
   * Performs a safe delete operation using If-Match header
   */
  public async deleteWithETag(req: Request, service: 'LFX_V2_SERVICE', path: string, etag: string, operation: string): Promise<void> {
    logger.debug(req, operation, 'Deleting resource with ETag', { step: 'delete_with_etag', path, has_etag: !!etag });

    await this.microserviceProxy.proxyRequest(req, service, path, 'DELETE', {}, undefined, { [HTTP_HEADERS.IF_MATCH]: etag });
  }
}
