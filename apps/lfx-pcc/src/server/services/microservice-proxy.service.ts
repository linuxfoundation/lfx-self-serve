// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_QUERY_PARAMS, MICROSERVICE_URLS } from '@lfx-pcc/shared/constants';
import { MicroserviceUrls } from '@lfx-pcc/shared/interfaces';
import { Request } from 'express';

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
    data?: any,
    params?: Record<string, any>
  ): Promise<T> {
    try {
      if (!req.bearerToken) {
        throw new Error('Bearer token not available on request');
      }

      const baseUrl = MICROSERVICE_URLS[service];
      const endpoint = `${baseUrl}${path}`;
      // const token = req.bearerToken;
      const token = process.env['QUERY_SERVICE_TOKEN'] as string;

      // Merge query parameters with defaults taking precedence
      // This ensures that default params cannot be overridden by the caller
      const defaultParams = DEFAULT_QUERY_PARAMS[service] || {};
      const mergedParams = { ...params, ...defaultParams };

      const response = await this.executeRequest<T>(method, endpoint, token, data, mergedParams);
      return response.data;
    } catch (error) {
      console.error(`Microservice request failed: ${service}${path}`, {
        method,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw this.transformError(error, service, path);
    }
  }

  private async executeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    bearerToken: string,
    data?: any,
    params?: Record<string, any>
  ) {
    switch (method) {
      case 'GET':
        return await this.apiClient.get<T>(endpoint, bearerToken, params);
      case 'POST':
        return await this.apiClient.post<T>(endpoint, bearerToken, data);
      case 'PUT':
        return await this.apiClient.put<T>(endpoint, bearerToken, data);
      case 'PATCH':
        return await this.apiClient.patch<T>(endpoint, bearerToken, data);
      case 'DELETE':
        return await this.apiClient.delete<T>(endpoint, bearerToken);
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }
  }

  private transformError(error: any, service: string, path: string): Error {
    const originalMessage = error instanceof Error ? error.message : String(error);

    const statusCode = error.status || 500;

    let userMessage: string;
    let errorCode: string;

    switch (statusCode) {
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
        if (originalMessage.includes('timeout')) {
          userMessage = 'Request timeout. Please try again.';
          errorCode = 'TIMEOUT';
        } else if (originalMessage.includes('Network')) {
          userMessage = 'Network error. Please check your connection and try again.';
          errorCode = 'NETWORK_ERROR';
        } else {
          userMessage = 'An unexpected error occurred. Please try again later.';
          errorCode = 'UNKNOWN_ERROR';
        }
    }

    const transformedError = new Error(userMessage);
    (transformedError as any).code = errorCode;
    (transformedError as any).status = statusCode;
    (transformedError as any).service = service;
    (transformedError as any).path = path;
    (transformedError as any).originalMessage = originalMessage;

    return transformedError;
  }
}
