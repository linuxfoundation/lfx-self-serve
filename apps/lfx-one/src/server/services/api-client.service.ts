// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApiClientConfig, ApiResponse } from '@lfx-one/shared/interfaces';

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

  /**
   * Make a binary request that returns a Buffer instead of parsing JSON
   * @param type HTTP method
   * @param url Request URL
   * @param bearerToken Optional bearer token for authentication
   * @param query Optional query parameters
   * @param customHeaders Optional custom headers
   * @returns Promise with ApiResponse containing Buffer data
   */
  public binaryRequest(
    type: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    bearerToken?: string,
    query?: Record<string, any>,
    customHeaders?: Record<string, string>
  ): Promise<ApiResponse<Buffer>> {
    const fullUrl = this.getFullUrl(url, query);
    return this.makeBinaryRequest(type, fullUrl, bearerToken, customHeaders);
  }

  private async makeRequest<T>(method: string, url: string, bearerToken?: string, data?: any, customHeaders?: Record<string, string>): Promise<ApiResponse<T>> {
    // Check if data is FormData (from form-data package for Node.js)
    const isFormData = data && typeof data === 'object' && typeof data.append === 'function' && typeof data.getHeaders === 'function';

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ['User-Agent']: 'LFX-PCC-Server/1.0',
    };

    // If data is FormData, get its headers (includes Content-Type with boundary)
    if (isFormData) {
      const formDataHeaders = data.getHeaders();
      Object.assign(headers, formDataHeaders);
    } else {
      headers['Content-Type'] = 'application/json';
    }

    // Only add Authorization header if bearerToken is provided
    if (bearerToken) {
      headers['Authorization'] = `Bearer ${bearerToken}`;
    }

    if (customHeaders) {
      Object.assign(headers, customHeaders);
    }

    const requestInit: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.config.timeout),
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      if (isFormData) {
        // For FormData (from form-data package in Node.js), we need to:
        // 1. Convert FormData to a buffer (since Node.js fetch doesn't handle streams well)
        // 2. Calculate and set Content-Length header
        try {
          // Get the FormData as a buffer
          const formDataBuffer = data.getBuffer();
          const contentLength = formDataBuffer.length;

          // Set Content-Length header
          headers['Content-Length'] = String(contentLength);

          // Use the buffer as the body
          requestInit.body = formDataBuffer;
        } catch {
          // Fallback: try to use the FormData directly as a stream
          const contentLength = data.getLengthSync?.();
          if (contentLength) {
            headers['Content-Length'] = String(contentLength);
          }
          requestInit.body = data as any;
        }
      } else {
        // For regular JSON data, stringify it
        requestInit.body = JSON.stringify(data);
      }
    }

    return this.executeRequest<T>(url, requestInit);
  }

  private async makeBinaryRequest(method: string, url: string, bearerToken?: string, customHeaders?: Record<string, string>): Promise<ApiResponse<Buffer>> {
    const headers: Record<string, string> = {
      ['User-Agent']: 'LFX-PCC-Server/1.0',
    };

    // Add custom headers
    if (customHeaders) {
      Object.assign(headers, customHeaders);
    }

    // Only add Authorization header if bearerToken is provided
    if (bearerToken) {
      headers['Authorization'] = `Bearer ${bearerToken}`;
    }

    const requestInit: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.config.timeout),
    };

    return this.executeBinaryRequest(url, requestInit);
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

  private async executeBinaryRequest(url: string, requestInit: RequestInit): Promise<ApiResponse<Buffer>> {
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
          operation: 'api_client_binary_request',
          service: 'api_client_service',
          path: url,
          errorBody: errorBody,
        });
      }

      // Get the response as an ArrayBuffer and convert to Buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const apiResponse: ApiResponse<Buffer> = {
        data: buffer,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      };

      return apiResponse;
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new MicroserviceError(`Request timeout after ${this.config.timeout}ms`, 408, 'TIMEOUT', {
            operation: 'api_client_binary_timeout',
            service: 'api_client_service',
            path: url,
          });
        }

        const errorWithCause = error as Error & { cause?: { code?: string } };
        if (errorWithCause.cause?.code) {
          throw new MicroserviceError(`Request failed: ${error.message}`, 500, errorWithCause.cause.code || 'NETWORK_ERROR', {
            operation: 'api_client_binary_network_error',
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
