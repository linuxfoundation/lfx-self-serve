// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ETagError, ETagResult, extractErrorDetails } from '@lfx-pcc/shared/interfaces';
import { HTTP_HEADERS } from '@lfx-pcc/shared/constants';
import { Request } from 'express';

import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Service for handling ETag-based operations with microservices
 */
export class ETagService {
  public constructor(private microserviceProxy: MicroserviceProxyService) {}

  /**
   * Fetches a resource with ETag header for safe operations
   */
  public async fetchWithETag<T>(req: Request, service: 'LFX_V2_SERVICE', path: string, operation: string): Promise<ETagResult<T>> {
    req.log.info(
      {
        operation,
        step: 'fetch_with_etag',
        path,
      },
      'Fetching resource to obtain ETag header'
    );

    try {
      const response = await this.microserviceProxy.proxyRequestWithResponse<T>(req, service, path, 'GET');

      if (!response.data) {
        const error: ETagError = {
          code: 'NOT_FOUND',
          message: 'Resource not found',
          statusCode: 404,
        };
        throw error;
      }

      const etag = response.headers[HTTP_HEADERS.ETAG.toLowerCase()] || response.headers[HTTP_HEADERS.ETAG];

      if (!etag) {
        req.log.warn(
          {
            operation,
            path,
            error: 'ETag header not found in response',
            available_headers: Object.keys(response.headers),
          },
          'ETag header missing from resource response'
        );

        const error: ETagError = {
          code: 'ETAG_MISSING',
          message: 'Unable to obtain ETag header for safe operation',
          statusCode: 500,
          headers: response.headers,
        };
        throw error;
      }

      req.log.info(
        {
          operation,
          step: 'resource_fetched',
          path,
          has_etag: true,
        },
        'Resource fetched successfully with ETag'
      );

      return {
        data: response.data,
        etag,
        headers: response.headers,
      };
    } catch (error) {
      if (this.isETagError(error)) {
        throw error;
      }

      const errorDetails = extractErrorDetails(error);
      const etagError: ETagError = {
        code: 'NETWORK_ERROR',
        message: errorDetails.message,
        statusCode: errorDetails.statusCode,
      };
      throw etagError;
    }
  }

  /**
   * Performs a safe update operation using If-Match header
   */
  public async updateWithETag<T>(req: Request, service: 'LFX_V2_SERVICE', path: string, etag: string, data: any, operation: string): Promise<T> {
    req.log.info(
      {
        operation,
        step: 'update_with_etag',
        path,
        etag_value: etag,
      },
      'Attempting to update resource with If-Match header'
    );

    return await this.microserviceProxy.proxyRequest<T>(req, service, path, 'PUT', {}, data, { [HTTP_HEADERS.IF_MATCH]: etag });
  }

  /**
   * Performs a safe delete operation using If-Match header
   */
  public async deleteWithETag(req: Request, service: 'LFX_V2_SERVICE', path: string, etag: string, operation: string): Promise<void> {
    req.log.info(
      {
        operation,
        step: 'delete_with_etag',
        path,
        etag_value: etag,
      },
      'Attempting to delete resource with If-Match header'
    );

    await this.microserviceProxy.proxyRequest(req, service, path, 'DELETE', {}, undefined, { [HTTP_HEADERS.IF_MATCH]: etag });
  }

  /**
   * Type guard for ETag errors
   */
  private isETagError(error: unknown): error is ETagError {
    if (error === null || typeof error !== 'object') return false;

    const errorObj = error as Record<string, unknown>;
    return (
      typeof errorObj['code'] === 'string' &&
      typeof errorObj['statusCode'] === 'number' &&
      ['NOT_FOUND', 'ETAG_MISSING', 'NETWORK_ERROR', 'PRECONDITION_FAILED'].includes(errorObj['code'] as string)
    );
  }
}
