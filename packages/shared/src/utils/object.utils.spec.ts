// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for object.utils.ts — `yarn test` (this file runs under the packages/shared Vitest project).
// Scoped to assertNeverSilent. nullifyEmptyStrings, isObjectRow, and isObjectRowArray have no
// behavioral coverage yet — project.service.spec.ts references nullifyEmptyStrings but only via
// `vi.mock('@lfx-one/shared/utils', ...) -> nullifyEmptyStrings: vi.fn()`, a stub that exercises
// none of its actual logic.

import { describe, expect, it } from 'vitest';

import { assertNeverSilent } from './object.utils';

describe('assertNeverSilent', () => {
  it('does not throw — the compile-time exhaustiveness check is the entire point', () => {
    expect(() => assertNeverSilent('unhandled' as never)).not.toThrow();
  });

  it('returns undefined', () => {
    expect(assertNeverSilent('unhandled' as never)).toBeUndefined();
  });
});
