// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { ServiceValidationError } from '../errors';

/**
 * Strict single-value query reader: rejects (not silently discards) a defined-but-non-string value.
 * Express's default `qs`-based query parser (`express.urlencoded({ extended: true })` in `server.ts`)
 * turns a repeated param (`?page_token=a&page_token=b`) into an array, not a string — treating that
 * the same as "absent" would silently restart pagination (`page_token`), ignore `since`, or fall back
 * `page_size` to its default, with no error surfaced to the caller.
 *
 * Lives in its own module, not `validation.helper.ts`: that module imports `@lfx-one/shared/utils`,
 * which pulls in Angular-only runtime code Vitest can't resolve outside an Angular context — a
 * standalone module keeps every consumer's unit spec importable without mocking (the constraint that
 * previously kept this reader inlined per-helper).
 */
export function getStrictStringQueryParam(req: Request, name: string, operation: string): string | undefined {
  const value = req.query[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw ServiceValidationError.forField(name, `${name} must be provided once, as a single string value`, { operation });
  }
  return value;
}
