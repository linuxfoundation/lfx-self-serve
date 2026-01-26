// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SENSITIVE_FIELDS } from '@lfx-one/shared/constants';
import { Request } from 'express';

import { serverLogger } from '../server-logger';

/**
 * Operation state for tracking active operations per request
 */
interface OperationState {
  startTime: number;
  operation: string;
  logged: boolean;
}

/**
 * Options for starting an operation
 */
interface StartOperationOptions {
  silent?: boolean;
}

/**
 * Options for error logging
 */
interface ErrorOptions {
  skipIfLogged?: boolean;
}

/**
 * LoggerService - Singleton service for consistent, deduplicated logging
 *
 * Features:
 * - Operation tracking to prevent duplicate logs (request-scoped only)
 * - CloudWatch-optimized JSON output
 * - Request correlation via request_id (when req provided)
 * - Duration tracking for performance monitoring
 * - Supports both request-scoped (with req) and infrastructure (without req) logging
 */
export class LoggerService {
  private static instance: LoggerService;

  /**
   * WeakMap to track operations per request without memory leaks
   * Key: Request object, Value: Map of operation name to state
   */
  private operationStacks = new WeakMap<Request, Map<string, OperationState>>();

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): LoggerService {
    if (!LoggerService.instance) {
      LoggerService.instance = new LoggerService();
    }
    return LoggerService.instance;
  }

  /**
   * Starts tracking an operation and logs at INFO level
   * Returns startTime for duration calculation
   * @param req - Request object (optional - use undefined for infrastructure operations)
   */
  public startOperation(req: Request | undefined, operation: string, metadata: Record<string, unknown> = {}, options: StartOperationOptions = {}): number {
    const startTime = Date.now();

    // Infrastructure logging (no request context)
    if (!req) {
      if (!options.silent) {
        serverLogger.info(
          {
            operation,
            status: 'started',
            ...(Object.keys(metadata).length > 0 && { data: metadata }),
          },
          `Starting ${this.formatOperation(operation)}`
        );
      }
      return startTime;
    }

    // Request-scoped logging with deduplication tracking
    const stack = this.getOperationStack(req);

    // Check for duplicate start calls
    if (stack.has(operation)) {
      const existing = stack.get(operation);
      if (existing && !existing.logged) {
        req.log.warn(
          {
            operation,
            warning: 'duplicate_start_detected',
            original_start: existing.startTime,
            request_id: req.id,
          },
          `Duplicate start detected for ${this.formatOperation(operation)}`
        );
      }
    }

    // Store operation state
    stack.set(operation, {
      startTime,
      operation,
      logged: false,
    });

    // Log start unless silent mode
    if (!options.silent) {
      req.log.info(
        {
          operation,
          status: 'started',
          request_id: req.id,
          user_agent: req.get('User-Agent'),
          ip_address: req.ip,
          ...(Object.keys(metadata).length > 0 && { data: metadata }),
        },
        `Starting ${this.formatOperation(operation)}`
      );
    }

    return startTime;
  }

  /**
   * Logs successful completion of an operation
   * @param req - Request object (optional - use undefined for infrastructure operations)
   */
  public success(req: Request | undefined, operation: string, startTime: number, metadata: Record<string, unknown> = {}): void {
    const duration = Date.now() - startTime;

    // Infrastructure logging (no request context)
    if (!req) {
      const { status_code, ...restMetadata } = metadata as { status_code?: number; [key: string]: unknown };
      serverLogger.info(
        {
          operation,
          status: 'success',
          duration_ms: duration,
          ...(status_code && { status_code }),
          ...(Object.keys(restMetadata).length > 0 && { data: restMetadata }),
        },
        `Successfully completed ${this.formatOperation(operation)}`
      );
      return;
    }

    // Request-scoped logging with deduplication tracking
    const stack = this.getOperationStack(req);
    const opState = stack.get(operation);

    // Mark as logged to prevent duplicate logging
    if (opState) {
      opState.logged = true;
    }

    // Extract status_code from metadata if present, rest goes to data
    const { status_code, ...restMetadata } = metadata as { status_code?: number; [key: string]: unknown };

    req.log.info(
      {
        operation,
        status: 'success',
        duration_ms: duration,
        status_code: status_code || 200,
        request_id: req.id,
        ...(Object.keys(restMetadata).length > 0 && { data: restMetadata }),
      },
      `Successfully completed ${this.formatOperation(operation)}`
    );

    // Clean up completed operation
    stack.delete(operation);
  }

  /**
   * Logs operation failure with error details
   * Can skip logging if already logged (prevents duplicates - request-scoped only)
   * @param req - Request object (optional - use undefined for infrastructure operations)
   */
  public error(
    req: Request | undefined,
    operation: string,
    startTime: number,
    error: unknown,
    metadata: Record<string, unknown> = {},
    options: ErrorOptions = {}
  ): void {
    const duration = Date.now() - startTime;

    // Infrastructure logging (no request context)
    if (!req) {
      serverLogger.error(
        {
          operation,
          status: 'failed',
          duration_ms: duration,
          err: error,
          ...(Object.keys(metadata).length > 0 && { data: metadata }),
        },
        `Failed to ${this.formatOperation(operation)}`
      );
      return;
    }

    // Request-scoped logging with deduplication tracking
    const stack = this.getOperationStack(req);
    const opState = stack.get(operation);

    // Skip if already logged and skipIfLogged is true
    if (options.skipIfLogged && opState?.logged) {
      req.log.debug(
        {
          operation,
          skip_reason: 'already_logged',
          request_id: req.id,
        },
        `Skipping duplicate error log for ${this.formatOperation(operation)}`
      );
      return;
    }

    // Mark as logged
    if (opState) {
      opState.logged = true;
    }

    req.log.error(
      {
        operation,
        status: 'failed',
        duration_ms: duration,
        err: error,
        request_id: req.id,
        ...(Object.keys(metadata).length > 0 && { data: metadata }),
      },
      `Failed to ${this.formatOperation(operation)}`
    );

    // Clean up failed operation
    stack.delete(operation);
  }

  /**
   * Logs validation errors
   * @param req - Request object (optional - use undefined for infrastructure operations)
   */
  public validation(req: Request | undefined, operation: string, validationErrors: unknown[], metadata: Record<string, unknown> = {}): void {
    // Infrastructure logging (no request context)
    if (!req) {
      serverLogger.error(
        {
          operation,
          status: 'failed',
          error_type: 'validation',
          validation_errors: validationErrors,
          status_code: 400,
          ...(Object.keys(metadata).length > 0 && { data: metadata }),
        },
        `Validation failed for ${this.formatOperation(operation)}`
      );
      return;
    }

    // Request-scoped logging
    req.log.error(
      {
        operation,
        status: 'failed',
        error_type: 'validation',
        validation_errors: validationErrors,
        status_code: 400,
        request_id: req.id,
        ...(Object.keys(metadata).length > 0 && { data: metadata }),
      },
      `Validation failed for ${this.formatOperation(operation)}`
    );
  }

  /**
   * Logs ETag-related operations
   * @param req - Request object (optional - use undefined for infrastructure operations)
   */
  public etag(
    req: Request | undefined,
    operation: string,
    resourceType: string,
    resourceId: string,
    etag?: string,
    metadata: Record<string, unknown> = {}
  ): void {
    // Infrastructure logging (no request context)
    if (!req) {
      serverLogger.info(
        {
          operation,
          resource_type: resourceType,
          resource_id: resourceId,
          etag,
          ...(Object.keys(metadata).length > 0 && { data: metadata }),
        },
        `ETag operation: ${this.formatOperation(operation)}`
      );
      return;
    }

    // Request-scoped logging
    req.log.info(
      {
        operation,
        resource_type: resourceType,
        resource_id: resourceId,
        etag,
        request_id: req.id,
        ...(Object.keys(metadata).length > 0 && { data: metadata }),
      },
      `ETag operation: ${this.formatOperation(operation)}`
    );
  }

  /**
   * Logs warning messages with operation context
   * @param req - Request object (optional - use undefined for infrastructure operations)
   */
  public warning(req: Request | undefined, operation: string, message: string, metadata: Record<string, unknown> = {}): void {
    // Extract err from metadata to place at top level for proper error serialization
    const { err, ...rest } = metadata;

    // Infrastructure logging (no request context)
    if (!req) {
      serverLogger.warn(
        {
          operation,
          status: 'warning',
          warning_message: message,
          ...(err ? { err } : {}), // err at top level for Pino error serializer
          ...(Object.keys(rest).length > 0 && { data: rest }),
        },
        `Warning during ${this.formatOperation(operation)}: ${message}`
      );
      return;
    }

    // Request-scoped logging
    req.log.warn(
      {
        operation,
        status: 'warning',
        warning_message: message,
        request_id: req.id,
        ...(err ? { err } : {}), // err at top level for Pino error serializer
        ...(Object.keys(rest).length > 0 && { data: rest }),
      },
      `Warning during ${this.formatOperation(operation)}: ${message}`
    );
  }

  /**
   * Logs info messages with operation context
   * Use for significant business operations that should be visible in production
   * @param req - Request object (optional - use undefined for infrastructure operations)
   */
  public info(req: Request | undefined, operation: string, message: string, metadata: Record<string, unknown> = {}): void {
    // Extract err from metadata to place at top level for proper error serialization
    const { err, ...rest } = metadata;

    // Infrastructure logging (no request context)
    if (!req) {
      serverLogger.info(
        {
          operation,
          status: 'info',
          ...(err ? { err } : {}), // err at top level for Pino error serializer
          ...(Object.keys(rest).length > 0 && { data: rest }),
        },
        `${this.formatOperation(operation)}: ${message}`
      );
      return;
    }

    // Request-scoped logging
    req.log.info(
      {
        operation,
        status: 'info',
        request_id: req.id,
        ...(err ? { err } : {}), // err at top level for Pino error serializer
        ...(Object.keys(rest).length > 0 && { data: rest }),
      },
      `${this.formatOperation(operation)}: ${message}`
    );
  }

  /**
   * Logs debug messages with operation context
   * Use for detailed internal state, preparation steps, or verbose information
   * @param req - Request object (optional - use undefined for infrastructure operations)
   */
  public debug(req: Request | undefined, operation: string, message: string, metadata: Record<string, unknown> = {}): void {
    // Extract err from metadata to place at top level for proper error serialization
    const { err, ...rest } = metadata;

    // Infrastructure logging (no request context)
    if (!req) {
      serverLogger.debug(
        {
          operation,
          status: 'debug',
          ...(err ? { err } : {}), // err at top level for Pino error serializer
          ...(Object.keys(rest).length > 0 && { data: rest }),
        },
        `${this.formatOperation(operation)}: ${message}`
      );
      return;
    }

    // Request-scoped logging
    req.log.debug(
      {
        operation,
        status: 'debug',
        request_id: req.id,
        ...(err ? { err } : {}), // err at top level for Pino error serializer
        ...(Object.keys(rest).length > 0 && { data: rest }),
      },
      `${this.formatOperation(operation)}: ${message}`
    );
  }

  /**
   * Sanitizes sensitive data from metadata before logging
   */
  public sanitize(metadata: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...metadata };

    Object.keys(sanitized).forEach((key) => {
      if (SENSITIVE_FIELDS.some((field) => key.toLowerCase().includes(field))) {
        sanitized[key] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  /**
   * Checks if an operation has been started
   */
  public hasOperation(req: Request, operation: string): boolean {
    const stack = this.getOperationStack(req);
    return stack.has(operation);
  }

  /**
   * Gets the start time of an operation (useful for nested operations)
   */
  public getOperationStartTime(req: Request, operation: string): number | undefined {
    const stack = this.getOperationStack(req);
    return stack.get(operation)?.startTime;
  }

  /**
   * Get or create the operation stack for a request
   */
  private getOperationStack(req: Request): Map<string, OperationState> {
    if (!this.operationStacks.has(req)) {
      this.operationStacks.set(req, new Map());
    }
    return this.operationStacks.get(req)!;
  }

  /**
   * Format operation name for log messages
   */
  private formatOperation(operation: string): string {
    return operation.replace(/_/g, ' ');
  }
}

// Export singleton instance for convenient usage
export const logger = LoggerService.getInstance();
