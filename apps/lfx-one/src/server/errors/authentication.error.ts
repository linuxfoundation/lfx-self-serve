// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BaseApiError } from './base.error';

/**
 * Error class for authentication failures
 * Used when a user attempts to access protected routes without proper authentication
 */
export class AuthenticationError extends BaseApiError {
  /** When true, `apiErrorHandler` clears `req.appSession` before responding, so express-openid-connect's
   * cookie-write hook (which fires independently of how the request settles) clears the session cookie
   * instead of reissuing it — needed whenever the thrown error means the session data can't be trusted. */
  public readonly clearSession: boolean;

  public constructor(
    message = 'Authentication required',
    options: {
      operation?: string;
      service?: string;
      path?: string;
      metadata?: Record<string, any>;
      clearSession?: boolean;
    } = {}
  ) {
    const { clearSession, ...rest } = options;
    super(message, 401, 'AUTHENTICATION_REQUIRED', rest);
    this.clearSession = clearSession ?? false;
  }
}

export class AuthorizationError extends BaseApiError {
  public constructor(
    message = 'Authorization required',
    options: {
      operation?: string;
      service?: string;
      path?: string;
      code?: string;
    } = {}
  ) {
    const { code, ...rest } = options;
    super(message, 403, code ?? 'AUTHORIZATION_REQUIRED', rest);
  }
}
