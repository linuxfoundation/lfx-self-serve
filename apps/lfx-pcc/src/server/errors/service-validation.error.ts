// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ValidationError } from '@lfx-pcc/shared/interfaces';
import { BaseApiError } from './base.error';

/**
 * Error class for service-level validation failures
 * Matches the format that microservices would return for validation errors
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
