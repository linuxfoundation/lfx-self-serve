// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request, NextFunction } from 'express';
import { ServiceValidationError } from '../errors';
import { Logger } from './logger';

/**
 * Common validation utilities for controllers
 * Reduces duplication of parameter validation logic
 */

/**
 * Options for validation helper functions
 */
interface ValidationOptions {
  operation: string;
  service?: string;
  logStartTime?: number;
}

/**
 * Validates that a UID parameter exists and is not empty
 * @param uid The UID value to validate
 * @param req Express request object
 * @param next Express next function for error handling
 * @param options Validation options including operation name
 * @returns true if validation passes, false if validation fails (error sent to next)
 */
export function validateUidParameter(uid: string | undefined, req: Request, next: NextFunction, options: ValidationOptions): uid is string {
  if (!uid || uid.trim() === '') {
    const error = new Error(`Missing ${options.operation.replace('_', ' ')} UID parameter`);

    if (options.logStartTime) {
      Logger.error(req, options.operation, options.logStartTime, error);
    }

    const validationError = ServiceValidationError.forField('uid', 'UID is required', {
      operation: options.operation,
      service: options.service || 'controller',
      path: req.path,
    });

    next(validationError);
    return false;
  }

  return true;
}

/**
 * Validates that an array parameter exists and is not empty
 * @param array The array to validate
 * @param fieldName Name of the field being validated
 * @param req Express request object
 * @param next Express next function for error handling
 * @param options Validation options including operation name
 * @returns true if validation passes, false if validation fails (error sent to next)
 */
export function validateArrayParameter<T>(
  array: T[] | undefined,
  fieldName: string,
  req: Request,
  next: NextFunction,
  options: ValidationOptions
): array is T[] {
  if (!Array.isArray(array) || array.length === 0) {
    const error = new Error(`Missing or empty ${fieldName} array parameter`);

    if (options.logStartTime) {
      Logger.error(req, options.operation, options.logStartTime, error);
    }

    const validationError = ServiceValidationError.forField(fieldName, `${fieldName} must be a non-empty array`, {
      operation: options.operation,
      service: options.service || 'controller',
      path: req.path,
    });

    next(validationError);
    return false;
  }

  return true;
}

/**
 * Validates that a required parameter exists
 * @param value The value to validate
 * @param fieldName Name of the field being validated
 * @param req Express request object
 * @param next Express next function for error handling
 * @param options Validation options including operation name
 * @returns true if validation passes, false if validation fails (error sent to next)
 */
export function validateRequiredParameter<T>(
  value: T | undefined | null,
  fieldName: string,
  req: Request,
  next: NextFunction,
  options: ValidationOptions
): value is T {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    const error = new Error(`Missing required parameter: ${fieldName}`);

    if (options.logStartTime) {
      Logger.error(req, options.operation, options.logStartTime, error);
    }

    const validationError = ServiceValidationError.forField(fieldName, `${fieldName} is required`, {
      operation: options.operation,
      service: options.service || 'controller',
      path: req.path,
    });

    next(validationError);
    return false;
  }

  return true;
}

/**
 * Validates that a request body exists
 * @param body The request body to validate
 * @param req Express request object
 * @param next Express next function for error handling
 * @param options Validation options including operation name
 * @returns true if validation passes, false if validation fails (error sent to next)
 */
export function validateRequestBody<T>(body: T | undefined, req: Request, next: NextFunction, options: ValidationOptions): body is T {
  if (!body || (typeof body === 'object' && Object.keys(body).length === 0)) {
    const error = new Error('Missing request body');

    if (options.logStartTime) {
      Logger.error(req, options.operation, options.logStartTime, error);
    }

    const validationError = ServiceValidationError.forField('body', 'Request body is required', {
      operation: options.operation,
      service: options.service || 'controller',
      path: req.path,
    });

    next(validationError);
    return false;
  }

  return true;
}
