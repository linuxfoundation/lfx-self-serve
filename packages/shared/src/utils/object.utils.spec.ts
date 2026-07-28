// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for object.utils.ts — `yarn test` (this file runs under the packages/shared Vitest project).
// Scoped to assertNever / assertNeverSilent. nullifyEmptyStrings is covered elsewhere
// (project.service.spec.ts); isObjectRow / isObjectRowArray have no dedicated coverage yet.

import { describe, expect, it } from 'vitest';

import { assertNever, assertNeverSilent } from './object.utils';

describe('assertNever', () => {
  it('throws at runtime as a backstop for the compile-time exhaustiveness check it exists for', () => {
    expect(() => assertNever('unhandled' as never)).toThrow('Unhandled case');
  });
});

describe('assertNeverSilent', () => {
  it('does not throw — the compile-time exhaustiveness check is the entire point', () => {
    expect(() => assertNeverSilent('unhandled' as never)).not.toThrow();
  });

  it('returns undefined', () => {
    expect(assertNeverSilent('unhandled' as never)).toBeUndefined();
  });
});
