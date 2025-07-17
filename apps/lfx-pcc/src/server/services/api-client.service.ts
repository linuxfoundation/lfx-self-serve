import { ApiClientConfig, ApiResponse } from '@lfx-pcc/shared/interfaces';

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

  public async get<T = any>(url: string, bearerToken: string, params?: Record<string, any>): Promise<ApiResponse<T>> {
    const queryString = params ? new URLSearchParams(params).toString() : '';
    const fullUrl = queryString ? `${url}?${queryString}` : url;

    return this.makeRequest<T>('GET', fullUrl, bearerToken);
  }

  public async post<T = any>(url: string, bearerToken: string, data?: any): Promise<ApiResponse<T>> {
    return this.makeRequest<T>('POST', url, bearerToken, data);
  }

  public async put<T = any>(url: string, bearerToken: string, data?: any): Promise<ApiResponse<T>> {
    return this.makeRequest<T>('PUT', url, bearerToken, data);
  }

  public async patch<T = any>(url: string, bearerToken: string, data?: any): Promise<ApiResponse<T>> {
    return this.makeRequest<T>('PATCH', url, bearerToken, data);
  }

  public async delete<T = any>(url: string, bearerToken: string): Promise<ApiResponse<T>> {
    return this.makeRequest<T>('DELETE', url, bearerToken);
  }

  private async makeRequest<T>(method: string, url: string, bearerToken: string, data?: any): Promise<ApiResponse<T>> {
    const requestInit: RequestInit = {
      method,
      headers: {
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
          break;
        }

        if (this.isRetryableError(error)) {
          await this.delay(this.config.retryDelay * attempt);
          continue;
        }

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

  private isRetryableError(error: any): boolean {
    // Timeout errors
    if (error.code === 'TIMEOUT' || error.name === 'AbortError') {
      return true;
    }

    // Network errors
    if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return true;
    }

    // Fetch network errors
    if (error.cause?.code === 'ECONNRESET' || error.cause?.code === 'ENOTFOUND' || error.cause?.code === 'ECONNREFUSED') {
      return true;
    }

    // Server errors (5xx)
    if (error.status >= 500 && error.status < 600) {
      return true;
    }

    // Rate limiting
    if (error.status === 429) {
      return true;
    }

    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
