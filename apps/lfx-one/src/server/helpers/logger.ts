// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SENSITIVE_FIELDS } from '@lfx-one/shared/constants';
import { Request } from 'express';

/**
 * Standardized request logging helper for consistent log formatting
 */
export class Logger {
  /**
   * Logs the start of an operation with timing
   */
  public static start(req: Request, operation: string, metadata: Record<string, any> = {}): number {
    const startTime = Date.now();

    req.log.info(
      {
        operation,
        ...metadata,
        request_id: req.id,
        user_agent: req.get('User-Agent'),
        ip_address: req.ip,
      },
      `Starting ${operation.replace(/_/g, ' ')}`
    );

    return startTime;
  }

  /**
   * Logs successful completion of an operation
   */
  public static success(req: Request, operation: string, startTime: number, metadata: Record<string, any> = {}): void {
    const duration = Date.now() - startTime;

    req.log.info(
      {
        operation,
        duration,
        status_code: metadata['status_code'] || 200,
        ...metadata,
        request_id: req.id,
      },
      `Successfully completed ${operation.replace(/_/g, ' ')}`
    );
  }

  /**
   * Logs operation failure with error details
   */
  public static error(req: Request, operation: string, startTime: number, error: unknown, metadata: Record<string, any> = {}): void {
    const duration = Date.now() - startTime;

    req.log.error(
      {
        operation,
        duration,
        err: error,
        ...metadata,
        request_id: req.id,
      },
      `Failed to ${operation.replace(/_/g, ' ')}`
    );
  }

  /**
   * Logs validation errors specifically
   */
  public static validation(req: Request, operation: string, validationErrors: any[], metadata: Record<string, any> = {}): void {
    req.log.warn(
      {
        operation,
        validation_errors: validationErrors,
        status_code: 400,
        ...metadata,
        request_id: req.id,
      },
      `Validation failed for ${operation.replace(/_/g, ' ')}`
    );
  }

  /**
   * Logs ETag-related operations
   */
  public static etag(req: Request, operation: string, resourceType: string, resourceId: string, etag?: string, metadata: Record<string, any> = {}): void {
    req.log.info(
      {
        operation,
        resource_type: resourceType,
        resource_id: resourceId,
        etag,
        ...metadata,
        request_id: req.id,
      },
      `ETag operation: ${operation.replace(/_/g, ' ')}`
    );
  }

  /**
   * Logs warning messages with operation context
   */
  public static warning(req: Request, operation: string, message: string, metadata: Record<string, any> = {}): void {
    req.log.warn(
      {
        operation,
        warning_message: message,
        ...metadata,
        request_id: req.id,
      },
      `Warning during ${operation.replace(/_/g, ' ')}: ${message}`
    );
  }

  /**
   * Sanitizes sensitive data from metadata before logging
   */
  public static sanitize(metadata: Record<string, any>): Record<string, any> {
    const sanitized = { ...metadata };

    Object.keys(sanitized).forEach((key) => {
      if (SENSITIVE_FIELDS.some((field) => key.toLowerCase().includes(field))) {
        sanitized[key] = '[REDACTED]';
      }
    });

    return sanitized;
  }
}
