// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export { BaseApiError } from './base.error';
export { MicroserviceError } from './microservice.error';
export { ServiceValidationError, ResourceNotFoundError } from './service-validation.error';

// Type guards for error identification
import { BaseApiError } from './base.error';
import { MicroserviceError } from './microservice.error';
import { ServiceValidationError } from './service-validation.error';

export function isMicroserviceError(error: unknown): error is MicroserviceError {
  return error instanceof MicroserviceError;
}

export function isServiceValidationError(error: unknown): error is ServiceValidationError {
  return error instanceof ServiceValidationError;
}

export function isBaseApiError(error: unknown): error is BaseApiError {
  return error instanceof BaseApiError;
}
