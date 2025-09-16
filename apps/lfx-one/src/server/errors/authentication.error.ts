// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BaseApiError } from './base.error';

/**
 * Error class for authentication failures
 * Used when a user attempts to access protected routes without proper authentication
 */
export class AuthenticationError extends BaseApiError {
  public constructor(
    message = 'Authentication required',
    options: {
      operation?: string;
      service?: string;
      path?: string;
      metadata?: Record<string, any>;
    } = {}
  ) {
    super(message, 401, 'AUTHENTICATION_REQUIRED', options);
  }
}

export class AuthorizationError extends BaseApiError {
  public constructor(
    message = 'Authorization required',
    options: {
      operation?: string;
      service?: string;
      path?: string;
    } = {}
  ) {
    super(message, 403, 'AUTHORIZATION_REQUIRED', options);
  }
}
