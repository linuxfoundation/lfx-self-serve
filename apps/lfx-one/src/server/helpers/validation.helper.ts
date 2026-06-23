// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request, NextFunction } from 'express';
import {
  HEALTH_METRICS_RANGES,
  MONTH_FORMAT_REGEX,
  AKRITES_ESCALATION_PATHS,
  AKRITES_INACTIVE_REASON_OPTIONS,
  AKRITES_STEWARD_ROLE_OPTIONS,
  VALID_CLASSIFICATIONS,
  isHealthMetricsRange,
} from '@lfx-one/shared/constants';
import { resolvePeriodRange } from '@lfx-one/shared/utils';
import { ServiceValidationError } from '../errors';

import type {
  AkritesActorInput,
  AkritesAssignStewardRequest,
  AkritesEscalateRequest,
  AkritesEscalationPath,
  AkritesHealthBand,
  AkritesInactiveReason,
  AkritesListParams,
  AkritesStatus,
  AkritesStewardRole,
  AkritesUpdatableStatus,
  AkritesUpdateStatusRequest,
  AkritesSortKey,
  HealthMetricsRange,
  ResolvedPeriodRange,
} from '@lfx-one/shared/interfaces';

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
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (year > currentYear || (year === currentYear && mo > currentMonth)) {
    throw ServiceValidationError.forField('month', 'Month cannot be in the future.', { operation });
  }

  return month;
}

/** Validates an optional `period` query param (YTD preset, trailing preset, or YYYY-MM month). Falls back to `month` param for backward compatibility. Returns a resolved date range or undefined. */
export function getValidatedPeriod(req: Request, operation: string): ResolvedPeriodRange | undefined {
  const period = getStringQueryParam(req, 'period');
  if (!period) {
    const month = getValidatedMonth(req, operation);
    if (!month) return undefined;
    const range = resolvePeriodRange(month);
    if (!range) {
      throw ServiceValidationError.forField('month', 'Invalid month value.', { operation });
    }
    return range;
  }

  const range = resolvePeriodRange(period);
  if (!range) {
    throw ServiceValidationError.forField('period', 'Invalid period value. Expected "ytd", "last-3", "last-6", or YYYY-MM (e.g. 2026-05).', {
      operation,
    });
  }
  return range;
}

/**
 * Validates that a request body exists
 * @param body The request body to validate
 * @param req Express request object
 * @param next Express next function for error handling
 * @param options Validation options including operation name
 * @returns true if validation passes, false if validation fails (error sent to next)
 */
const VALID_AKRITES_STATUSES = ['all', 'unassigned', 'open', 'assessing', 'active', 'needs_attention', 'escalated', 'blocked', 'inactive'] as const;
const VALID_AKRITES_HEALTH_BANDS: readonly AkritesHealthBand[] = ['healthy', 'fair', 'concerning', 'critical'];
const VALID_AKRITES_VULN_FILTERS: readonly NonNullable<AkritesListParams['vulnFilter']>[] = ['any', 'high', 'critical'];
const VALID_AKRITES_SORT_KEYS: readonly AkritesSortKey[] = ['risk', 'impact', 'health', 'vulns', 'name'];

/** Returns a validated AkritesStatus or undefined; throws 400 for unknown values. 'all' is accepted as a no-op and returns undefined. */
export function parseAkritesStatus(req: Request): AkritesStatus | undefined {
  const raw = getStringQueryParam(req, 'status');
  if (!raw) return undefined;
  if (!VALID_AKRITES_STATUSES.includes(raw as (typeof VALID_AKRITES_STATUSES)[number])) {
    throw ServiceValidationError.forField('status', `Invalid status. Allowed: ${VALID_AKRITES_STATUSES.join(', ')}`, {});
  }
  return raw === 'all' ? undefined : (raw as AkritesStatus);
}

/** Returns a validated AkritesHealthBand or undefined; throws 400 for unknown values. */
export function parseAkritesHealthBand(req: Request): AkritesHealthBand | undefined {
  const raw = getStringQueryParam(req, 'healthBand');
  if (!raw) return undefined;
  if (!VALID_AKRITES_HEALTH_BANDS.includes(raw as AkritesHealthBand)) {
    throw ServiceValidationError.forField('healthBand', `Invalid healthBand. Allowed: ${VALID_AKRITES_HEALTH_BANDS.join(', ')}`, {});
  }
  return raw as AkritesHealthBand;
}

/** Returns a validated vulnFilter or undefined; throws 400 for unknown values. */
export function parseAkritesVulnFilter(req: Request): AkritesListParams['vulnFilter'] {
  const raw = getStringQueryParam(req, 'vulnFilter');
  if (!raw) return undefined;
  if (!VALID_AKRITES_VULN_FILTERS.includes(raw as NonNullable<AkritesListParams['vulnFilter']>)) {
    throw ServiceValidationError.forField('vulnFilter', `Invalid vulnFilter. Allowed: ${VALID_AKRITES_VULN_FILTERS.join(', ')}`, {});
  }
  return raw as AkritesListParams['vulnFilter'];
}

/** Returns a validated AkritesSortKey or undefined; throws 400 for unknown values. */
export function parseAkritesSortKey(req: Request): AkritesSortKey | undefined {
  const raw = getStringQueryParam(req, 'sortBy');
  if (!raw) return undefined;
  if (!VALID_AKRITES_SORT_KEYS.includes(raw as AkritesSortKey)) {
    throw ServiceValidationError.forField('sortBy', `Invalid sortBy. Allowed: ${VALID_AKRITES_SORT_KEYS.join(', ')}`, {});
  }
  return raw as AkritesSortKey;
}

const VALID_AKRITES_STEWARD_ROLES: readonly AkritesStewardRole[] = AKRITES_STEWARD_ROLE_OPTIONS.map((o) => o.value);
const VALID_AKRITES_ESCALATION_PATHS: readonly AkritesEscalationPath[] = AKRITES_ESCALATION_PATHS.map((o) => o.value);
const VALID_AKRITES_INACTIVE_REASONS: readonly AkritesInactiveReason[] = AKRITES_INACTIVE_REASON_OPTIONS.map((o) => o.value);
const VALID_AKRITES_UPDATABLE_STATUSES: readonly AkritesUpdatableStatus[] = ['assessing', 'active', 'needs_attention', 'blocked', 'inactive'];

/** Parses and validates the `:id` route param as a positive integer stewardship id; throws 400 otherwise. */
export function parseStewardshipId(req: Request, operation: string): number {
  const raw = req.params['id'];
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw ServiceValidationError.forField('id', 'Stewardship id must be a positive integer', { operation });
  }
  return id;
}

function parseActor(raw: unknown, operation: string): AkritesActorInput {
  const actor = raw as { userId?: unknown; username?: unknown; displayName?: unknown; avatarUrl?: unknown } | undefined;
  if (!actor || typeof actor !== 'object') {
    throw ServiceValidationError.forField('actor', 'actor object is required', { operation });
  }
  if (typeof actor.userId !== 'string' || actor.userId.trim() === '') {
    throw ServiceValidationError.forField('actor.userId', 'actor.userId is required', { operation });
  }
  return {
    userId: actor.userId.trim(),
    username: typeof actor.username === 'string' ? actor.username.trim() || null : null,
    displayName: typeof actor.displayName === 'string' ? actor.displayName.trim() || null : null,
    avatarUrl: typeof actor.avatarUrl === 'string' ? actor.avatarUrl.trim() || null : null,
  };
}

/** Validates the open-stewardship body; returns purl and actor; throws 400 otherwise. */
export function parseOpenStewardshipBody(req: Request, operation: string): { purl: string; actor: AkritesActorInput } {
  const body = (req.body ?? {}) as { purl?: unknown; actor?: unknown };
  const purl = body.purl;
  if (typeof purl !== 'string' || purl.trim() === '' || !purl.trim().startsWith('pkg:')) {
    throw ServiceValidationError.forField('purl', 'purl is required and must start with "pkg:"', { operation });
  }
  return { purl: purl.trim(), actor: parseActor(body.actor, operation) };
}

/** Validates the assign-steward body; throws 400 for missing/invalid fields. */
export function parseAssignStewardBody(req: Request, operation: string): AkritesAssignStewardRequest & { actor: AkritesActorInput } {
  const body = (req.body ?? {}) as { steward?: unknown; moveToAssessing?: unknown; actor?: unknown };
  const steward = body.steward as { userId?: unknown; username?: unknown; displayName?: unknown; role?: unknown } | undefined;

  if (!steward || typeof steward !== 'object') {
    throw ServiceValidationError.forField('steward', 'steward object is required', { operation });
  }
  if (typeof steward.userId !== 'string' || steward.userId.trim() === '') {
    throw ServiceValidationError.forField('steward.userId', 'steward.userId is required', { operation });
  }
  if (typeof steward.role !== 'string' || !VALID_AKRITES_STEWARD_ROLES.includes(steward.role as AkritesStewardRole)) {
    throw ServiceValidationError.forField('steward.role', `Invalid role. Allowed: ${VALID_AKRITES_STEWARD_ROLES.join(', ')}`, { operation });
  }
  if (body.moveToAssessing !== undefined && typeof body.moveToAssessing !== 'boolean') {
    throw ServiceValidationError.forField('moveToAssessing', 'moveToAssessing must be a boolean', { operation });
  }

  return {
    steward: {
      userId: steward.userId.trim(),
      username: typeof steward.username === 'string' ? steward.username.trim() || null : null,
      displayName: typeof steward.displayName === 'string' ? steward.displayName.trim() || null : null,
      role: steward.role as AkritesStewardRole,
    },
    moveToAssessing: body.moveToAssessing as boolean | undefined,
    actor: parseActor(body.actor, operation),
  };
}

/** Validates the escalate body; throws 400 for missing/invalid fields. */
export function parseEscalateBody(req: Request, operation: string): AkritesEscalateRequest & { actor: AkritesActorInput } {
  const body = (req.body ?? {}) as { resolutionPath?: unknown; notes?: unknown; actor?: unknown };

  if (typeof body.resolutionPath !== 'string' || !VALID_AKRITES_ESCALATION_PATHS.includes(body.resolutionPath as AkritesEscalationPath)) {
    throw ServiceValidationError.forField('resolutionPath', `Invalid resolutionPath. Allowed: ${VALID_AKRITES_ESCALATION_PATHS.join(', ')}`, { operation });
  }
  if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.trim() === '')) {
    throw ServiceValidationError.forField('notes', 'notes must be a non-empty string when provided', { operation });
  }

  return {
    resolutionPath: body.resolutionPath as AkritesEscalationPath,
    notes: typeof body.notes === 'string' ? body.notes.trim() : undefined,
    actor: parseActor(body.actor, operation),
  };
}

/** Validates the update-status body; requires inactiveReason when status is `inactive`. Throws 400 otherwise. */
export function parseUpdateStatusBody(req: Request, operation: string): AkritesUpdateStatusRequest & { actor: AkritesActorInput } {
  const body = (req.body ?? {}) as { status?: unknown; inactiveReason?: unknown; notes?: unknown; actor?: unknown };

  if (typeof body.status !== 'string' || !VALID_AKRITES_UPDATABLE_STATUSES.includes(body.status as AkritesUpdatableStatus)) {
    throw ServiceValidationError.forField('status', `Invalid status. Allowed: ${VALID_AKRITES_UPDATABLE_STATUSES.join(', ')}`, { operation });
  }
  if (
    body.inactiveReason !== undefined &&
    (typeof body.inactiveReason !== 'string' || !VALID_AKRITES_INACTIVE_REASONS.includes(body.inactiveReason as AkritesInactiveReason))
  ) {
    throw ServiceValidationError.forField('inactiveReason', `Invalid inactiveReason. Allowed: ${VALID_AKRITES_INACTIVE_REASONS.join(', ')}`, { operation });
  }
  if (body.status === 'inactive' && body.inactiveReason === undefined) {
    throw ServiceValidationError.forField('inactiveReason', 'inactiveReason is required when status is inactive', { operation });
  }

  return {
    status: body.status as AkritesUpdatableStatus,
    inactiveReason: body.inactiveReason as AkritesInactiveReason | undefined,
    notes: typeof body.notes === 'string' && body.notes.trim() !== '' ? body.notes.trim() : undefined,
    actor: parseActor(body.actor, operation),
  };
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
