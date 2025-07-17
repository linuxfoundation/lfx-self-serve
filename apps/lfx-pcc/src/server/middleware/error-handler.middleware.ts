// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request, Response, NextFunction } from 'express';
import { ApiError } from '@lfx-pcc/shared/interfaces';

export function apiErrorHandler(error: ApiError, req: Request, res: Response, next: NextFunction): void {
  // If response already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(error);
  }

  // Handle authentication errors
  if (error.message === 'User not authenticated') {
    res.status(401).json({
      error: 'Authentication required',
      code: 'UNAUTHORIZED',
      path: req.path,
    });
    return;
  }

  if (error.message === 'Bearer token not available') {
    res.status(401).json({
      error: 'Bearer token required. Include Authorization: Bearer <token> header or authenticate via session.',
      code: 'TOKEN_REQUIRED',
      path: req.path,
    });
    return;
  }

  if (error.message === 'Access token not available') {
    res.status(401).json({
      error: 'Access token not available',
      code: 'TOKEN_UNAVAILABLE',
      path: req.path,
    });
    return;
  }

  // Handle errors with status codes (from microservice proxy)
  if (error.code && error.status) {
    res.status(error.status).json({
      error: error.message,
      code: error.code,
      service: error.service,
      path: req.path,
      ...(error.originalMessage && { originalMessage: error.originalMessage }),
    });
    return;
  }

  // Handle validation errors
  if (error.name === 'ValidationError') {
    res.status(400).json({
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      path: req.path,
      details: error.message,
    });
    return;
  }

  // Log unhandled errors
  console.error('Unhandled API error:', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    userAgent: req.get('User-Agent'),
  });

  // Default error response
  res.status(error.status || 500).json({
    error: error.status ? error.message : 'Internal server error',
    code: error.code || 'INTERNAL_ERROR',
    path: req.path,
  });
}
