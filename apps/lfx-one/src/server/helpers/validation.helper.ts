// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request, NextFunction } from 'express';
import { HEALTH_METRICS_RANGES, MONTH_FORMAT_REGEX, VALID_CLASSIFICATIONS, isHealthMetricsRange } from '@lfx-one/shared/constants';
import { ServiceValidationError } from '../errors';

import type { HealthMetricsRange, OsspreyStatus, OsspreyHealthBand, OspreySortKey } from '@lfx-one/shared/interfaces';
import type { OsspreyListParams } from '@lfx-one/shared/interfaces';

/**
 * Common validation utilities for controllers
 * Reduces duplication of parameter validation logic
 *
 * Note: These helpers do NOT log — the centralized apiErrorHandler
 * logs all ServiceValidationErrors at WARN via getSeverity().
 */

/**
 * Options for validation helper functions
 */
interface ValidationOptions {
  operation: string;
  service?: string;
}

/**
 * Validates that a UID route parameter exists and is not empty.
 * For validating named body/query fields, use validateRequiredParameter instead.
 */
export function validateUidParameter(uid: unknown, req: Request, next: NextFunction, options: ValidationOptions): uid is string {
  if (typeof uid !== 'string' || uid.trim() === '') {
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
 * Safely extracts a string query parameter. Returns undefined if the param is
 * missing or not a string (e.g. client sent repeated keys producing an array).
 * Prevents type confusion via parameter tampering (CodeQL js/type-confusion-through-parameter-tampering).
 *
 * NOTE: This only ensures the value is a string — callers are still responsible
 * for validating format (e.g. SLUG_PATTERN.test()) and length constraints
 * (e.g. NAME_MAX_LENGTH) before passing the value to downstream services or queries.
 *
 * @param req Express request object
 * @param name Query parameter name
 * @returns The string value, or undefined if missing or not a string
 */
export function getStringQueryParam(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Validates and narrows a raw range string to a HealthMetricsRange.
 * Throws ServiceValidationError when the value is not in the allowed set.
 */
export function assertHealthMetricsRange(range: string, operation: string): HealthMetricsRange {
  if (!isHealthMetricsRange(range)) {
    throw ServiceValidationError.forField('range', `Invalid range value. Allowed: ${HEALTH_METRICS_RANGES.join(', ')}`, { operation });
  }
  return range;
}

const VALID_ENTITY_TYPES = ['foundation', 'project'] as const;
export type EntityType = (typeof VALID_ENTITY_TYPES)[number];

export function parseEntityType(req: Request, operation: string): EntityType {
  const raw = getStringQueryParam(req, 'entityType');
  if (!raw) {
    throw ServiceValidationError.forField('entityType', 'entityType query parameter is required', { operation });
  }
  if (!VALID_ENTITY_TYPES.includes(raw as EntityType)) {
    throw ServiceValidationError.forField('entityType', 'entityType must be "foundation" or "project"', { operation });
  }
  return raw as EntityType;
}

/**
 * Extracts and validates the optional `classification` query parameter.
 * @param req Express request object
 * @param operation Operation name used in error metadata
 * @returns The validated classification string, or undefined if not provided
 * @throws {ServiceValidationError} When the value is not in VALID_CLASSIFICATIONS
 */
export function getValidatedClassification(req: Request, operation: string): string | undefined {
  const classification = getStringQueryParam(req, 'classification');
  if (classification && !VALID_CLASSIFICATIONS.has(classification)) {
    throw ServiceValidationError.forField('classification', `Invalid classification value. Allowed: ${[...VALID_CLASSIFICATIONS].join(', ')}`, {
      operation,
    });
  }
  return classification;
}

/** Validates an optional `month` query param (YYYY-MM). Returns the validated string or undefined. Throws ServiceValidationError for invalid format or future months. */
export function getValidatedMonth(req: Request, operation: string): string | undefined {
  const month = getStringQueryParam(req, 'month');
  if (!month) return undefined;

  if (!MONTH_FORMAT_REGEX.test(month)) {
    throw ServiceValidationError.forField('month', 'Invalid month format. Expected YYYY-MM (e.g. 2026-05).', { operation });
  }

  const [year, mo] = month.split('-').map(Number);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (year > currentYear || (year === currentYear && mo > currentMonth)) {
    throw ServiceValidationError.forField('month', 'Month cannot be in the future.', { operation });
  }

  return month;
}

/**
 * Validates that a request body exists
 * @param body The request body to validate
 * @param req Express request object
 * @param next Express next function for error handling
 * @param options Validation options including operation name
 * @returns true if validation passes, false if validation fails (error sent to next)
 */
const VALID_OSSPREY_STATUSES = ['all', 'unassigned', 'open', 'assessing', 'active', 'needs_attention', 'escalated', 'blocked', 'inactive'] as const;
const VALID_OSSPREY_HEALTH_BANDS: readonly OsspreyHealthBand[] = ['healthy', 'fair', 'concerning', 'critical'];
const VALID_OSSPREY_VULN_FILTERS: readonly NonNullable<OsspreyListParams['vulnFilter']>[] = ['any', 'high', 'critical'];
const VALID_OSSPREY_SORT_KEYS: readonly OspreySortKey[] = ['risk', 'impact', 'health', 'vulns', 'name'];

/** Returns a validated OsspreyStatus or undefined; throws 400 for unknown values. 'all' is accepted as a no-op and returns undefined. */
export function parseOsspreyStatus(req: Request): OsspreyStatus | undefined {
  const raw = getStringQueryParam(req, 'status');
  if (!raw) return undefined;
  if (!VALID_OSSPREY_STATUSES.includes(raw as (typeof VALID_OSSPREY_STATUSES)[number])) {
    throw ServiceValidationError.forField('status', `Invalid status. Allowed: ${VALID_OSSPREY_STATUSES.join(', ')}`, {});
  }
  return raw === 'all' ? undefined : (raw as OsspreyStatus);
}

/** Returns a validated OsspreyHealthBand or undefined; throws 400 for unknown values. */
export function parseOsspreyHealthBand(req: Request): OsspreyHealthBand | undefined {
  const raw = getStringQueryParam(req, 'healthBand');
  if (!raw) return undefined;
  if (!VALID_OSSPREY_HEALTH_BANDS.includes(raw as OsspreyHealthBand)) {
    throw ServiceValidationError.forField('healthBand', `Invalid healthBand. Allowed: ${VALID_OSSPREY_HEALTH_BANDS.join(', ')}`, {});
  }
  return raw as OsspreyHealthBand;
}

/** Returns a validated vulnFilter or undefined; throws 400 for unknown values. */
export function parseOsspreyVulnFilter(req: Request): OsspreyListParams['vulnFilter'] {
  const raw = getStringQueryParam(req, 'vulnFilter');
  if (!raw) return undefined;
  if (!VALID_OSSPREY_VULN_FILTERS.includes(raw as NonNullable<OsspreyListParams['vulnFilter']>)) {
    throw ServiceValidationError.forField('vulnFilter', `Invalid vulnFilter. Allowed: ${VALID_OSSPREY_VULN_FILTERS.join(', ')}`, {});
  }
  return raw as OsspreyListParams['vulnFilter'];
}

/** Returns a validated OspreySortKey or undefined; throws 400 for unknown values. */
export function parseOspreySortKey(req: Request): OspreySortKey | undefined {
  const raw = getStringQueryParam(req, 'sortBy');
  if (!raw) return undefined;
  if (!VALID_OSSPREY_SORT_KEYS.includes(raw as OspreySortKey)) {
    throw ServiceValidationError.forField('sortBy', `Invalid sortBy. Allowed: ${VALID_OSSPREY_SORT_KEYS.join(', ')}`, {});
  }
  return raw as OspreySortKey;
}

export function validateRequestBody<T>(body: T | undefined, req: Request, next: NextFunction, options: ValidationOptions): body is T {
  if (!body || (typeof body === 'object' && Object.keys(body).length === 0)) {
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
