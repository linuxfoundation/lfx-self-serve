// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { BaseApiError, isBaseApiError } from '../errors';
import { logger } from '../services/logger.service';

/**
 * Derives operation name from request path for logging context
 */
function getOperationFromPath(path: string): string {
  // Convert /api/v1/meetings/123 to api_v1_meetings
  return (
    path
      .replace(/^\//, '') // Remove leading slash
      .replace(/\/[0-9a-f-]{36}/gi, '') // Remove UUIDs
      .replace(/\/\d+/g, '') // Remove numeric IDs
      .replace(/\//g, '_') // Convert slashes to underscores
      .replace(/_+$/, '') || 'api_request'
  ); // Remove trailing underscores
}

export function apiErrorHandler(error: Error | BaseApiError, req: Request, res: Response, next: NextFunction): void {
  // If response already sent, delegate to default Express error handler
  if (res.headersSent) {
    next(error);
    return;
  }

  const operation = getOperationFromPath(req.path);

  // Try to get the operation start time if it was tracked, otherwise use current time
  const startTime = logger.getOperationStartTime(req, operation) || Date.now();

  // Handle our structured API errors
  if (isBaseApiError(error)) {
    // Log the error with structured context for CloudWatch
    const logLevel = error.getSeverity();
    const logContext = {
      error_type: error.code,
      status_code: error.statusCode,
      ...error.getLogContext(),
      request_id: req.id,
      path: req.path,
      method: req.method,
      user_agent: req.get('User-Agent'),
    };

    if (logLevel === 'error') {
      logger.error(req, operation, startTime, error, logContext, { skipIfLogged: true });
    } else if (logLevel === 'warn') {
      logger.warning(req, operation, `API error: ${error.message}`, { ...logContext, err: error });
    } else {
      logger.debug(req, operation, `API error: ${error.message}`, { ...logContext, err: error });
    }

    // Send structured response
    res.status(error.statusCode).json({
      ...error.toResponse(),
      path: req.path,
    });
    return;
  }

  // Log unhandled errors with CloudWatch-friendly structure
  logger.error(
    req,
    operation,
    startTime,
    error,
    {
      error_type: 'unhandled',
      path: req.path,
      method: req.method,
      user_agent: req.get('User-Agent'),
    },
    { skipIfLogged: true }
  );

  // Default error response for unhandled errors
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    path: req.path,
  });
}
