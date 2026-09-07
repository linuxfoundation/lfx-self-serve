// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

// validation.helper.ts's OTHER exports (query-param validators unrelated to getStringQueryParam)
// import `@lfx-one/shared/utils` for `resolvePeriodRange` — that barrel transitively pulls
// Angular (`@angular/common`'s `PlatformLocation`), which fails to JIT-compile outside an Angular
// test bed (confirmed directly: importing this module without this mock throws "JIT compilation
// failed for injectable PlatformLocation"). `@lfx-one/shared/constants` does NOT need mocking — it
// is plain-Node-safe by invariant; see `packages/shared/src/constants/index.spec.ts`, the single
// source of truth for that guarantee — and should not be mocked here regardless: a well-intentioned
// partial stub (e.g. faking the `AKRITES_*` arrays this file's other exports read at module scope
// with `[]`) doesn't even throw, it just silently empties out those exports' real allow-lists —
// worse than the loud failure an entirely-missing stub would produce. getStringQueryParam itself
// has zero dependency on either import; the `utils` mock below exists solely to let the module
// load. `weekly-brief.controller.spec.ts` also now loads the real `getStringQueryParam` (via the
// same `importOriginal` pattern, real `constants` included), so this is no longer the only place
// it runs — but it's still the one place its narrowing behavior (string | string[] | ParsedQs |
// undefined -> string | undefined) is directly, exhaustively pinned by name.
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

  it('narrows a nested-object value to undefined — express parses ?x[a]=b into x: ParsedQs, not a string', () => {
    expect(getStringQueryParam({ query: { x: { a: 'b' } } } as any, 'x')).toBeUndefined();
  });
});
