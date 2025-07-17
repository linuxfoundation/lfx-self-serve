import { ApiError, ApiErrorOptions } from '@lfx-pcc/shared/interfaces';

export function createApiError(options: ApiErrorOptions): ApiError {
  const error = new Error(options.message) as ApiError;
  
  if (options.status !== undefined) {
    error.status = options.status;
  }
  
  if (options.code) {
    error.code = options.code;
  }
  
  if (options.service) {
    error.service = options.service;
  }
  
  if (options.path) {
    error.path = options.path;
  }
  
  if (options.originalMessage) {
    error.originalMessage = options.originalMessage;
  }

  // Add additional properties without casting
  if (options.originalError) {
    Object.assign(error, { originalError: options.originalError });
  }

  if (options.response) {
    Object.assign(error, { response: options.response });
  }

  return error;
}

export function createTimeoutError(timeout: number): ApiError {
  return createApiError({
    message: `Request timeout after ${timeout}ms`,
    code: 'TIMEOUT',
  });
}

export function createNetworkError(message: string, code?: string, originalError?: Error): ApiError {
  return createApiError({
    message: `Request failed: ${message}`,
    code: code || 'NETWORK_ERROR',
    originalError,
  });
}

export function createHttpError(status: number, statusText: string, response?: any): ApiError {
  return createApiError({
    message: `HTTP ${status}: ${statusText}`,
    status,
    code: getHttpErrorCode(status),
    response,
  });
}

function getHttpErrorCode(status: number): string {
  if (status >= 400 && status < 500) {
    switch (status) {
      case 400: return 'BAD_REQUEST';
      case 401: return 'UNAUTHORIZED';
      case 403: return 'FORBIDDEN';
      case 404: return 'NOT_FOUND';
      case 409: return 'CONFLICT';
      case 422: return 'VALIDATION_ERROR';
      case 429: return 'RATE_LIMITED';
      default: return 'CLIENT_ERROR';
    }
  }
  
  if (status >= 500 && status < 600) {
    switch (status) {
      case 500: return 'INTERNAL_ERROR';
      case 502: return 'BAD_GATEWAY';
      case 503: return 'SERVICE_UNAVAILABLE';
      case 504: return 'GATEWAY_TIMEOUT';
      default: return 'SERVER_ERROR';
    }
  }
  
  return 'HTTP_ERROR';
}