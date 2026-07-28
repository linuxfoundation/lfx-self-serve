// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for object.utils.ts — `yarn test` (this file runs under the packages/shared Vitest project).
// Scoped to assertNever; the file's other exports (nullifyEmptyStrings, isObjectRow,
// isObjectRowArray) pre-date this spec and are covered elsewhere/transitively.

import { describe, expect, it } from 'vitest';

import { assertNever } from './object.utils';

describe('assertNever', () => {
  it('throws at runtime as a backstop for the compile-time exhaustiveness check it exists for', () => {
    expect(() => assertNever('unhandled' as never)).toThrow('Unhandled case');
  });
});
