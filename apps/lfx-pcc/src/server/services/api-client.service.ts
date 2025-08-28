// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApiClientConfig, ApiResponse } from '@lfx-pcc/shared/interfaces';
import { extractErrorDetails } from '@lfx-pcc/shared/utils';

import { serverLogger } from '../server';
import { createHttpError, createNetworkError, createTimeoutError } from '../utils/api-error';

export class ApiClientService {
  private readonly config: Required<ApiClientConfig>;

  public constructor(config: ApiClientConfig = {}) {
    this.config = {
      timeout: config.timeout || 30000,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 1000,
    };
  }

  public async get<T = any>(url: string, bearerToken: string, params?: Record<string, any>, customHeaders?: Record<string, string>): Promise<ApiResponse<T>> {
    const queryString = params ? new URLSearchParams(params).toString() : '';
    const fullUrl = queryString ? `${url}?${queryString}` : url;

    return this.makeRequest<T>('GET', fullUrl, bearerToken, undefined, customHeaders);
  }

  public async post<T = any>(url: string, bearerToken: string, data?: any, customHeaders?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.makeRequest<T>('POST', url, bearerToken, data, customHeaders);
  }

  public async put<T = any>(url: string, bearerToken: string, data?: any, customHeaders?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.makeRequest<T>('PUT', url, bearerToken, data, customHeaders);
  }

  public async patch<T = any>(url: string, bearerToken: string, data?: any, customHeaders?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.makeRequest<T>('PATCH', url, bearerToken, data, customHeaders);
  }

  public async delete<T = any>(url: string, bearerToken: string, customHeaders?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.makeRequest<T>('DELETE', url, bearerToken, undefined, customHeaders);
  }

  private async makeRequest<T>(method: string, url: string, bearerToken: string, data?: any, customHeaders?: Record<string, string>): Promise<ApiResponse<T>> {
    const requestInit: RequestInit = {
      method,
      headers: {
        ...customHeaders,
        Authorization: `Bearer ${bearerToken}`,
        Accept: 'application/json',
        ['Content-Type']: 'application/json',
        ['User-Agent']: 'LFX-PCC-Server/1.0',
      },
      signal: AbortSignal.timeout(this.config.timeout),
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      requestInit.body = JSON.stringify(data);
    }

    return this.makeRequestWithRetry<T>(url, requestInit);
  }

  private async makeRequestWithRetry<T>(url: string, requestInit: RequestInit): Promise<ApiResponse<T>> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        return await this.executeRequest<T>(url, requestInit);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === this.config.retryAttempts) {
          serverLogger.error(
            {
              url,
              method: requestInit.method,
              attempt,
              max_attempts: this.config.retryAttempts,
              error: lastError.message,
              error_name: lastError.name,
            },
            'API request failed after all retry attempts'
          );
          break;
        }

        if (this.isRetryableError(error)) {
          serverLogger.warn(
            {
              url,
              method: requestInit.method,
              attempt,
              max_attempts: this.config.retryAttempts,
              error: lastError.message,
              retry_delay: this.config.retryDelay * attempt,
              will_retry: true,
            },
            'API request failed, retrying'
          );

          await this.delay(this.config.retryDelay * attempt);
          continue;
        }

        serverLogger.error(
          {
            url,
            method: requestInit.method,
            attempt,
            error: lastError.message,
            error_name: lastError.name,
            will_retry: false,
          },
          'API request failed with non-retryable error'
        );

        throw lastError;
      }
    }

    throw lastError!;
  }

  private async executeRequest<T>(url: string, requestInit: RequestInit): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(url, requestInit);

      // Convert Headers to record
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // Get response body
      const text = await response.text();
      let data: T;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error('Failed to parse response body');
      }

      const apiResponse: ApiResponse<T> = {
        data,
        status: response.status,
        statusText: response.statusText,
        headers,
      };

      if (!response.ok) {
        throw createHttpError(response.status, response.statusText, apiResponse);
      }

      return apiResponse;
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw createTimeoutError(this.config.timeout);
        }

        const errorWithCause = error as Error & { cause?: { code?: string } };
        if (errorWithCause.cause?.code) {
          throw createNetworkError(error.message, errorWithCause.cause.code, error);
        }
      }

      throw error;
    }
  }

  private isRetryableError(error: unknown): boolean {
    const errorDetails = extractErrorDetails(error);

    // Timeout errors
    if (errorDetails.code === 'TIMEOUT' || (error instanceof Error && error.name === 'AbortError')) {
      return true;
    }

    // Network errors - check if error has these specific codes
    if (error && typeof error === 'object') {
      const errorObj = error as Record<string, unknown>;
      const errorCode = errorObj['code'];

      if (errorCode === 'ECONNRESET' || errorCode === 'ENOTFOUND' || errorCode === 'ECONNREFUSED') {
        return true;
      }

      // Fetch network errors
      const cause = errorObj['cause'] as Record<string, unknown> | undefined;
      if (cause && typeof cause === 'object') {
        const causeCode = cause['code'];
        if (causeCode === 'ECONNRESET' || causeCode === 'ENOTFOUND' || causeCode === 'ECONNREFUSED') {
          return true;
        }
      }
    }

    // Server errors (5xx)
    if (errorDetails.statusCode >= 500 && errorDetails.statusCode < 600) {
      return true;
    }

    // Rate limiting
    if (errorDetails.statusCode === 429) {
      return true;
    }

    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
