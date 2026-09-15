// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ValidationError } from '@lfx-one/shared/interfaces';

import { BaseApiError } from './base.error';

/**
 * Error class for service-level validation failures
 * Matches the format that microservices would return for validation errors
 *
 * The `Validation failed` messages below are a wire contract, not just copy: the frontend reads the
 * prefix to know the top-level message names a wire key and the readable reason is in `errors[]`
 * (`readErrorBodyMessage`, shared by both frontend readers). They are written out rather than interpolated from
 * `VALIDATION_FAILED_MESSAGE_PREFIX` because most server specs stub `@lfx-one/shared/constants`
 * wholesale; `service-validation.error.spec.ts` pins them against that constant instead, so a reword
 * on either side fails loudly.
 */
export class ServiceValidationError extends BaseApiError {
  public readonly validationErrors: ValidationError[];

  public constructor(
    validationErrors: ValidationError[],
    message = 'Validation failed',
    options: {
      operation?: string;
      service?: string;
      path?: string;
    } = {}
  ) {
    super(message, 400, 'VALIDATION_ERROR', options);
    this.validationErrors = validationErrors;
  }

  public override toResponse(): Record<string, any> {
    return {
      ...super.toResponse(),
      errors: this.validationErrors,
    };
  }

  public override getLogContext(): Record<string, any> {
    return {
      ...super.getLogContext(),
      validation_errors: this.validationErrors,
    };
  }

  /**
   * Factory method to create from field validation errors
   */
  public static fromFieldErrors(
    fieldErrors: Record<string, string | string[]>,
    message = 'Validation failed',
    options: {
      operation?: string;
      service?: string;
      path?: string;
    } = {}
  ): ServiceValidationError {
    const validationErrors: ValidationError[] = Object.entries(fieldErrors).map(([field, messages]) => ({
      field,
      message: Array.isArray(messages) ? messages.join(', ') : messages,
      code: 'FIELD_VALIDATION_ERROR',
    }));

    return new ServiceValidationError(validationErrors, message, options);
  }

  /**
   * Factory method for single field validation error
   */
  public static forField(
    field: string,
    message: string,
    options: {
      operation?: string;
      service?: string;
      path?: string;
    } = {}
  ): ServiceValidationError {
    return new ServiceValidationError([{ field, message, code: 'FIELD_VALIDATION_ERROR' }], `Validation failed for ${field}`, options);
  }
}

/**
 * Error class for resource not found scenarios in services
 */
export class ResourceNotFoundError extends BaseApiError {
  public constructor(
    resourceType: string,
    resourceId?: string,
    options: {
      operation?: string;
      service?: string;
      path?: string;
    } = {}
  ) {
    const message = resourceId ? `${resourceType} with ID '${resourceId}' not found` : `${resourceType} not found`;

    super(message, 404, 'NOT_FOUND', options);
  }
}

/**
 * Error class for state-conflict scenarios (e.g. an action is invalid for the resource's current
 * state — a read-only checklist, an invalid status transition, self-acceptance). Always 409; the
 * caller-supplied `code` names the specific conflict (e.g. the upstream `reason` uppercased).
 * NOT for optimistic-locking version mismatches — see {@link PreconditionFailedError} (412) for those.
 */
export class ConflictError extends BaseApiError {
  public constructor(
    message: string,
    code: string,
    options: {
      operation?: string;
      service?: string;
      path?: string;
    } = {}
  ) {
    super(message, 409, code, options);
  }
}

/**
 * Error class for optimistic-locking version mismatches (upstream `reason: 'version_mismatch'`,
 * HTTP 412 on a mutation whose `If-Match` no longer matches the resource's current `version`).
 * Distinct from {@link ConflictError} (409): a 412 means the caller's local copy is stale and a
 * reload is needed before retrying, not that the requested transition itself is invalid.
 */
export class PreconditionFailedError extends BaseApiError {
  public constructor(
    message = 'The resource has changed since it was last read',
    options: {
      operation?: string;
      service?: string;
      path?: string;
    } = {}
  ) {
    super(message, 412, 'PRECONDITION_FAILED', options);
  }
}
