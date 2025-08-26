// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_QUERY_PARAMS } from '@lfx-pcc/shared/constants';
import { ApiError, ApiResponse, extractErrorDetails, MicroserviceUrls } from '@lfx-pcc/shared/interfaces';
import { Request } from 'express';

import { serverLogger } from '../server';
import { createApiError } from '../utils/api-error';
import { ApiClientService } from './api-client.service';

export class MicroserviceProxyService {
  private apiClient: ApiClientService;

  public constructor(apiClient: ApiClientService) {
    this.apiClient = apiClient;
  }

  public async proxyRequest<T>(
    req: Request,
    service: keyof MicroserviceUrls,
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
    params?: Record<string, any>,
    data?: any,
    customHeaders?: Record<string, string>
  ): Promise<T> {
    try {
      if (!req.bearerToken) {
        throw new Error('Bearer token not available on request');
      }

      const MICROSERVICE_URLS: MicroserviceUrls = {
        LFX_V2_SERVICE: process.env['LFX_V2_SERVICE'] || 'http://lfx-api.k8s.orb.local',
      };

      const baseUrl = MICROSERVICE_URLS[service];
      const endpoint = `${baseUrl}${path}`;
      const token = req.bearerToken;

      // Merge query parameters with defaults taking precedence
      // This ensures that default params cannot be overridden by the caller
      const defaultParams = DEFAULT_QUERY_PARAMS;
      const mergedParams = { ...params, ...defaultParams };

      const response = await this.executeRequest<T>(method, endpoint, token, data, mergedParams, customHeaders);
      return response.data;
    } catch (error) {
      serverLogger.error(
        {
          service,
          path,
          method,
          error: error instanceof Error ? error.message : error,
          stack: error instanceof Error && process.env['NODE_ENV'] !== 'production' ? error.stack : undefined,
          endpoint: `${service}${path}`,
          has_bearer_token: !!req.bearerToken,
        },
        'Microservice request failed'
      );

      throw this.transformError(error, service, path);
    }
  }

  public async proxyRequestWithResponse<T>(
    req: Request,
    service: keyof MicroserviceUrls,
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
    params?: Record<string, any>,
    data?: any,
    customHeaders?: Record<string, string>
  ): Promise<ApiResponse<T>> {
    try {
      if (!req.bearerToken) {
        throw new Error('Bearer token not available on request');
      }

      const MICROSERVICE_URLS: MicroserviceUrls = {
        LFX_V2_SERVICE: process.env['LFX_V2_SERVICE'] || 'http://lfx-api.k8s.orb.local',
      };

      const baseUrl = MICROSERVICE_URLS[service];
      const endpoint = `${baseUrl}${path}`;
      const token = req.bearerToken;

      // Merge query parameters with defaults taking precedence
      // This ensures that default params cannot be overridden by the caller
      const defaultParams = DEFAULT_QUERY_PARAMS;
      const mergedParams = { ...params, ...defaultParams };

      const response = await this.executeRequest<T>(method, endpoint, token, data, mergedParams, customHeaders);
      return response;
    } catch (error) {
      serverLogger.error(
        {
          service,
          path,
          method,
          error: error instanceof Error ? error.message : error,
          stack: error instanceof Error && process.env['NODE_ENV'] !== 'production' ? error.stack : undefined,
          endpoint: `${service}${path}`,
          has_bearer_token: !!req.bearerToken,
        },
        'Microservice request failed'
      );

      throw this.transformError(error, service, path);
    }
  }

  private async executeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    bearerToken: string,
    data?: any,
    params?: Record<string, any>,
    customHeaders?: Record<string, string>
  ) {
    switch (method) {
      case 'GET':
        return await this.apiClient.get<T>(endpoint, bearerToken, params, customHeaders);
      case 'POST':
        return await this.apiClient.post<T>(endpoint, bearerToken, data, customHeaders);
      case 'PUT':
        return await this.apiClient.put<T>(endpoint, bearerToken, data, customHeaders);
      case 'PATCH':
        return await this.apiClient.patch<T>(endpoint, bearerToken, data, customHeaders);
      case 'DELETE':
        return await this.apiClient.delete<T>(endpoint, bearerToken, customHeaders);
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }
  }

  private transformError(error: unknown, service: string, path: string): ApiError {
    const errorDetails = extractErrorDetails(error);

    let userMessage: string;
    let errorCode: string;

    switch (errorDetails.statusCode) {
      case 400:
        userMessage = 'Invalid request. Please check your input and try again.';
        errorCode = 'BAD_REQUEST';
        break;
      case 401:
        userMessage = 'Authentication required. Please log in and try again.';
        errorCode = 'UNAUTHORIZED';
        break;
      case 403:
        userMessage = 'Access denied. You do not have permission to access this resource.';
        errorCode = 'FORBIDDEN';
        break;
      case 404:
        userMessage = 'The requested resource was not found.';
        errorCode = 'NOT_FOUND';
        break;
      case 409:
        userMessage = 'Conflict. The resource you are trying to create already exists.';
        errorCode = 'CONFLICT';
        break;
      case 422:
        userMessage = 'Validation error. Please check your input and try again.';
        errorCode = 'VALIDATION_ERROR';
        break;
      case 429:
        userMessage = 'Too many requests. Please wait a moment and try again.';
        errorCode = 'RATE_LIMITED';
        break;
      case 500:
        userMessage = 'Internal server error. Please try again later.';
        errorCode = 'INTERNAL_ERROR';
        break;
      case 502:
      case 503:
      case 504:
        userMessage = 'Service temporarily unavailable. Please try again later.';
        errorCode = 'SERVICE_UNAVAILABLE';
        break;
      default:
        if (errorDetails.message.includes('timeout')) {
          userMessage = 'Request timeout. Please try again.';
          errorCode = 'TIMEOUT';
        } else if (errorDetails.message.includes('Network')) {
          userMessage = 'Network error. Please check your connection and try again.';
          errorCode = 'NETWORK_ERROR';
        } else {
          userMessage = 'An unexpected error occurred. Please try again later.';
          errorCode = 'UNKNOWN_ERROR';
        }
    }

    return createApiError({
      message: userMessage,
      statusCode: errorDetails.statusCode,
      code: errorCode,
      service,
      path,
      originalMessage: errorDetails.message,
      originalError: error instanceof Error ? error : undefined,
    });
  }
}
