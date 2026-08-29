// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

// validation.helper.ts's OTHER exports (query-param validators unrelated to getStringQueryParam)
// import `@lfx-one/shared/constants` and `@lfx-one/shared/utils` — both barrels transitively pull
// Angular (`@angular/common`'s `PlatformLocation`, via `resolvePeriodRange`'s own barrel), which
// fails to JIT-compile outside an Angular test bed (confirmed directly: importing this module
// unmocked throws "JIT compilation failed for injectable PlatformLocation"). getStringQueryParam
// itself has zero dependency on either import, so both are stubbed here — just enough to satisfy
// the few module-level statements that read from them (`AKRITES_STEWARD_ROLE_OPTIONS.map(...)`
// and its two siblings, evaluated at import time) — to load the REAL function rather than a
// caller-side re-implementation. Every controller spec that exercises `getStringQueryParam`
// mocks `../helpers/validation.helper` wholesale instead, for the same reason; this file is the
// one place the real narrowing behavior (string | string[] | ParsedQs | undefined -> string |
// undefined) is actually pinned.
vi.mock('@lfx-one/shared/constants', () => ({
  AKRITES_STEWARD_ROLE_OPTIONS: [],
  AKRITES_ESCALATION_PATHS: [],
  AKRITES_INACTIVE_REASON_OPTIONS: [],
}));
vi.mock('@lfx-one/shared/utils', () => ({}));

import { getStringQueryParam } from './validation.helper';

describe('getStringQueryParam', () => {
  it('returns the string value for a plain query param', () => {
    expect(getStringQueryParam({ query: { x: 'y' } } as any, 'x')).toBe('y');
  });

  it('narrows a repeated-key array to undefined — express parses ?x=y&x=y into x: string[], not the first value', () => {
    expect(getStringQueryParam({ query: { x: ['y', 'y'] } } as any, 'x')).toBeUndefined();
  });

  it('narrows an absent key to undefined', () => {
    expect(getStringQueryParam({ query: {} } as any, 'x')).toBeUndefined();
  });
});
