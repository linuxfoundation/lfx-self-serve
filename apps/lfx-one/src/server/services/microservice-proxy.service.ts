// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_QUERY_PARAMS } from '@lfx-one/shared/constants';
import { ApiResponse, MicroserviceUrls } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { ApiClientService } from './api-client.service';

export class MicroserviceProxyService {
  private apiClient: ApiClientService = new ApiClientService();

  public async proxyRequest<T>(
    req: Request,
    service: keyof MicroserviceUrls,
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
    query?: Record<string, any>,
    data?: any,
    customHeaders?: Record<string, string>
  ): Promise<T> {
    const operation = `${method.toLowerCase()}_${path.replace(/\//g, '_')}`;

    try {
      const MICROSERVICE_URLS: MicroserviceUrls = {
        LFX_V2_SERVICE: process.env['LFX_V2_SERVICE'] || 'http://lfx-api.k8s.orb.local',
      };

      const baseUrl = MICROSERVICE_URLS[service];
      const endpoint = `${baseUrl}${path}`;
      const token = req.bearerToken;

      // Merge query parameters with defaults taking precedence
      // This ensures that default params cannot be overridden by the caller
      const mergedQuery = { ...query, ...DEFAULT_QUERY_PARAMS };

      const response = await this.apiClient.request<T>(method, endpoint, token, mergedQuery, data, customHeaders);
      return response.data;
    } catch (error: any) {
      // Transform HTTP errors from API client into MicroserviceError
      if (error.status && error.code) {
        throw MicroserviceError.fromMicroserviceResponse(error.status, error.message, error.errorBody, service, path, operation);
      }

      // Re-throw unexpected errors
      throw error;
    }
  }

  public async proxyRequestWithResponse<T>(
    req: Request,
    service: keyof MicroserviceUrls,
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
    query?: Record<string, any>,
    data?: any,
    customHeaders?: Record<string, string>
  ): Promise<ApiResponse<T>> {
    const operation = `${method.toLowerCase()}_${path.replace(/\//g, '_')}`;

    try {
      const MICROSERVICE_URLS: MicroserviceUrls = {
        LFX_V2_SERVICE: process.env['LFX_V2_SERVICE'] || 'http://lfx-api.k8s.orb.local',
      };

      const baseUrl = MICROSERVICE_URLS[service];
      const endpoint = `${baseUrl}${path}`;
      const token = req.bearerToken;

      // Merge query parameters with defaults taking precedence
      // This ensures that default params cannot be overridden by the caller
      const mergedQuery = { ...query, ...DEFAULT_QUERY_PARAMS };

      const response = await this.apiClient.request<T>(method, endpoint, token, mergedQuery, data, customHeaders);
      return response;
    } catch (error: any) {
      // Transform HTTP errors from API client into MicroserviceError
      if (error.status && error.code) {
        throw MicroserviceError.fromMicroserviceResponse(error.status, error.message, error.errorBody, service, path, operation);
      }

      // Re-throw unexpected errors
      throw error;
    }
  }

  /**
   * Proxy a binary request to a microservice that returns a Buffer
   * @param req Express request object
   * @param service Microservice identifier
   * @param path API path
   * @param method HTTP method (defaults to GET)
   * @param query Query parameters
   * @param customHeaders Custom headers
   * @returns Promise with Buffer data
   */
  public async proxyBinaryRequest(
    req: Request,
    service: keyof MicroserviceUrls,
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
    query?: Record<string, any>,
    customHeaders?: Record<string, string>
  ): Promise<Buffer> {
    const operation = `${method.toLowerCase()}_${path.replace(/\//g, '_')}`;

    try {
      const MICROSERVICE_URLS: MicroserviceUrls = {
        LFX_V2_SERVICE: process.env['LFX_V2_SERVICE'] || 'http://lfx-api.k8s.orb.local',
      };

      const baseUrl = MICROSERVICE_URLS[service];
      const endpoint = `${baseUrl}${path}`;
      const token = req.bearerToken;

      // Merge query parameters with defaults taking precedence
      // This ensures that default params cannot be overridden by the caller
      const mergedQuery = { ...query, ...DEFAULT_QUERY_PARAMS };

      const response = await this.apiClient.binaryRequest(method, endpoint, token, mergedQuery, customHeaders);
      return response.data;
    } catch (error: any) {
      // Transform HTTP errors from API client into MicroserviceError
      if (error.status && error.code) {
        throw MicroserviceError.fromMicroserviceResponse(error.status, error.message, error.errorBody, service, path, operation);
      }

      // Re-throw unexpected errors
      throw error;
    }
  }
}
