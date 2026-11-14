// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AuthorizationError, AuthenticationError, ConflictError, MicroserviceError, ServiceValidationError } from '../errors';

export function isDefinitiveRedraftError(error: unknown): boolean {
  return (
    error instanceof ServiceValidationError || error instanceof ConflictError || error instanceof AuthorizationError || error instanceof AuthenticationError
  );
}
/** Classify only evidence of non-acceptance; timeout/unknown after POST is never permission to retry automatically. */
export function redraftWasNotAccepted(error: unknown, sessionExists: boolean): boolean {
  if (sessionExists) return false;
  if (isDefinitiveRedraftError(error)) return true;
  if (!(error instanceof MicroserviceError)) return false;
  if (error.service === 'guild' && error.operation === 'guild_create_session' && error.originalMessage?.startsWith('HTTP '))
    return (error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408 && error.statusCode !== 429) || error.statusCode === 501;
  const cause = error.originalError?.cause;
  if (cause && typeof cause === 'object' && 'code' in cause && (cause.code === 'ECONNREFUSED' || cause.code === 'ENOTFOUND')) return true;
  return ['guild_not_configured', 'guild_invalid_session_input', 'guild_unrouted_structured_input'].includes(error.code);
}
