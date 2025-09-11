// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApiClientConfig, ApiResponse } from '@lfx-pcc/shared/interfaces';

import { MicroserviceError } from '../errors';
import { getHttpErrorCode } from '../helpers/http-status.helper';

export class ApiClientService {
  private readonly config: Required<ApiClientConfig>;

  public constructor(config: ApiClientConfig = {}) {
    this.config = {
      timeout: config.timeout || 30000,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 1000,
    };
  }

  public request<T = any>(
    type: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    bearerToken?: string,
    query?: Record<string, any>,
    data?: any,
    customHeaders?: Record<string, string>
  ): Promise<ApiResponse<T>> {
    const fullUrl = this.getFullUrl(url, query);

    if (['GET', 'DELETE'].includes(type)) {
      return this.makeRequest<T>(type, fullUrl, bearerToken, undefined, customHeaders);
    }

    return this.makeRequest<T>(type, fullUrl, bearerToken, data, customHeaders);
  }

  private async makeRequest<T>(method: string, url: string, bearerToken?: string, data?: any, customHeaders?: Record<string, string>): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      ...customHeaders,
      Accept: 'application/json',
      ['Content-Type']: 'application/json',
      ['User-Agent']: 'LFX-PCC-Server/1.0',
    };

    // Only add Authorization header if bearerToken is provided
    if (bearerToken) {
      headers['Authorization'] = `Bearer ${bearerToken}`;
    }

    const requestInit: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.config.timeout),
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      requestInit.body = JSON.stringify(data);
    }

    return this.executeRequest<T>(url, requestInit);
  }

  private async executeRequest<T>(url: string, requestInit: RequestInit): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(url, requestInit);

      if (!response.ok) {
        // Try to parse error response body for additional details
        let errorBody: any = null;
        try {
          const errorText = await response.text();
          if (errorText) {
            errorBody = JSON.parse(errorText);
          }
        } catch {
          // If we can't parse the error body, we'll use the basic HTTP error
        }

        const errorMessage = errorBody?.message || errorBody?.error || response.statusText;

        throw new MicroserviceError(errorMessage, response.status, getHttpErrorCode(response.status), {
          operation: 'api_client_request',
          service: 'api_client_service',
          path: url,
          errorBody: errorBody,
        });
      }

      // If the response is text, parse it as JSON
      const data = await response.text();

      const apiResponse: ApiResponse<T> = {
        data: data ? JSON.parse(data) : null,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      };

      return apiResponse;
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new MicroserviceError(`Request timeout after ${this.config.timeout}ms`, 408, 'TIMEOUT', {
            operation: 'api_client_timeout',
            service: 'api_client_service',
            path: url,
          });
        }

        const errorWithCause = error as Error & { cause?: { code?: string } };
        if (errorWithCause.cause?.code) {
          throw new MicroserviceError(`Request failed: ${error.message}`, 500, errorWithCause.cause.code || 'NETWORK_ERROR', {
            operation: 'api_client_network_error',
            service: 'api_client_service',
            path: url,
            originalError: error,
          });
        }
      }

      throw error;
    }
  }

  private getFullUrl(url: string, query?: Record<string, any>): string {
    const queryString = query ? new URLSearchParams(query).toString() : '';
    return queryString ? `${url}?${queryString}` : url;
  }
}
