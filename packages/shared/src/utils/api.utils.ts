// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApiError, ValidationApiError } from '../interfaces/api.interface';

/**
 * Type guard to check if error is an ApiError
 */
export function isApiError(error: any): error is ApiError {
  return (
    ('status' in error && typeof error.status === 'number') ||
    ('statusCode' in error && typeof error.statusCode === 'number') ||
    ('code' in error && typeof error.code === 'string')
  );
}

/**
 * Type guard to check if error is a ValidationApiError
 */
export function isValidationApiError(error: unknown): error is ValidationApiError {
  if (!isApiError(error) || error.code !== 'VALIDATION_ERROR') return false;

  return 'validationErrors' in error && Array.isArray(error.validationErrors);
}

/**
 * Utility to safely extract error properties with proper typing
 */
export function extractErrorDetails(error: unknown): {
  message: string;
  statusCode: number;
  code: string;
  service?: string;
  path?: string;
} {
  if (isApiError(error)) {
    return {
      message: error.message,
      statusCode: error.statusCode || error.status || 500,
      code: error.code || 'UNKNOWN_ERROR',
      service: error.service,
      path: error.path,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    };
  }

  return {
    message: String(error),
    statusCode: 500,
    code: 'UNKNOWN_ERROR',
  };
}
