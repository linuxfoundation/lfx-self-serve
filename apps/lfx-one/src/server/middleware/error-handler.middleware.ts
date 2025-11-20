// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { BaseApiError, isBaseApiError } from '../errors';

export function apiErrorHandler(error: Error | BaseApiError, req: Request, res: Response, next: NextFunction): void {
  // If response already sent, delegate to default Express error handler
  if (res.headersSent) {
    next(error);
    return;
  }

  // Handle our structured API errors
  if (isBaseApiError(error)) {
    // Log the error with structured context
    const logLevel = error.getSeverity();
    const logContext = {
      ...error.getLogContext(),
      request_id: req.id,
      path: req.path,
      method: req.method,
      user_agent: req.get('User-Agent'),
    };

    if (logLevel === 'error') {
      req.log.error({ ...logContext, err: error }, `API error: ${error.message}`);
    } else if (logLevel === 'warn') {
      req.log.warn({ ...logContext, err: error }, `API error: ${error.message}`);
    } else {
      req.log.info({ ...logContext, err: error }, `API error: ${error.message}`);
    }

    // Send structured response
    res.status(error.statusCode).json({
      ...error.toResponse(),
      path: req.path,
    });
    return;
  }

  // Log unhandled errors
  req.log.error(
    {
      err: error,
      path: req.path,
      method: req.method,
      user_agent: req.get('User-Agent'),
      request_id: req.id,
    },
    'Unhandled API error'
  );

  // Default error response for unhandled errors
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    path: req.path,
  });
}
