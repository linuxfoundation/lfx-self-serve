// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Base error class for all API errors with structured metadata
 */
export abstract class BaseApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly operation?: string;
  public readonly service?: string;
  public readonly path?: string;
  public readonly metadata?: Record<string, any>;
  public readonly originalError?: Error;
  /** Set ONLY by the sites that raise a genuine transport failure. See toResponse. */
  public readonly transportFailure?: boolean;

  public constructor(
    message: string,
    statusCode: number,
    code: string,
    options: {
      operation?: string;
      service?: string;
      path?: string;
      metadata?: Record<string, any>;
      originalError?: Error;
      transportFailure?: boolean;
    } = {}
  ) {
    super(message);

    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.operation = options.operation;
    this.service = options.service;
    this.path = options.path;
    this.metadata = options.metadata;
    this.originalError = options.originalError;
    this.transportFailure = options.transportFailure;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Get the error severity level for logging
   */
  public getSeverity(): 'error' | 'warn' | 'info' {
    if (this.statusCode >= 500) {
      return 'error';
    }
    if (this.statusCode >= 400) {
      return 'warn';
    }
    return 'info';
  }

  /**
   * Get structured logging context
   */
  public getLogContext(): Record<string, any> {
    return {
      error_type: this.name,
      error_code: this.code,
      status_code: this.statusCode,
      operation: this.operation,
      service: this.service,
      path: this.path,
      metadata: this.metadata,
      original_error: this.originalError?.message,
    };
  }

  /**
   * Convert to JSON response format
   */
  public toResponse(): Record<string, any> {
    return {
      error: this.message,
      code: this.code,
      // Whether the BFF raised this as a TRANSPORT failure, declared explicitly by the site that
      // threw it -- not inferred from `originalError`.
      //
      // An earlier version derived it from `originalError !== undefined`, on the stated belief
      // that only transport sites set that. They do not: seven non-transport sites attach a
      // caught error to it (committee-access, org-lens x2, guild, snowflake x2, project), so
      // their 5xx responses were all being marked as lost connections. A client reading the
      // marker would have treated a genuine service fault as "our transport broke".
      //
      // Declared rather than inferred, because the syscall code is no proxy either: an ingress
      // 503 maps to SERVICE_UNAVAILABLE exactly like a real one, and ETIMEDOUT/EPIPE look
      // nothing like NETWORK_ERROR. The throwing site is the only thing that knows.
      ...(this.transportFailure && { transport: true }),
      ...(this.service && { service: this.service }),
      ...(this.path && { path: this.path }),
      ...(this.metadata && { metadata: this.metadata }),
    };
  }
}
