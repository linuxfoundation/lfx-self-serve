// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors committee-engagement.service.spec.ts / committee-engagement-window.helper.spec.ts: the
// `@lfx-one/shared/*` alias isn't wired into this app's vitest config, and the constants barrel
// pulls in transitive imports that don't survive outside an Angular build/test context. Deep-import
// the real constant (not a hand-copied literal) so a change to the default schema fails this suite too.
vi.mock('@lfx-one/shared/constants', async () => {
  const actual = await vi.importActual<typeof import('../../../../../packages/shared/src/constants/org-lens-projects.constants')>(
    '../../../../../packages/shared/src/constants/org-lens-projects.constants'
  );
  return { DEFAULT_LFX_ONE_PLATINUM_SCHEMA: actual.DEFAULT_LFX_ONE_PLATINUM_SCHEMA };
});

import { DEFAULT_LFX_ONE_PLATINUM_SCHEMA } from '@lfx-one/shared/constants';

import { resolveLfxOnePlatinumSchema } from './snowflake-schema.helper';

const ENV_KEY = 'LFX_ONE_PLATINUM_SCHEMA';
const originalValue = process.env[ENV_KEY];

describe('resolveLfxOnePlatinumSchema', () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalValue === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalValue;
  });

  it('falls back to the default schema when the env var is unset', () => {
    expect(resolveLfxOnePlatinumSchema()).toBe(DEFAULT_LFX_ONE_PLATINUM_SCHEMA);
  });

  it('accepts a well-formed two-segment override, normalized to uppercase', () => {
    process.env[ENV_KEY] = 'analytics.custom_schema';
    expect(resolveLfxOnePlatinumSchema()).toBe('ANALYTICS.CUSTOM_SCHEMA');
  });

  it('accepts a well-formed three-segment override', () => {
    process.env[ENV_KEY] = 'DB.SCHEMA.SUBSCHEMA';
    expect(resolveLfxOnePlatinumSchema()).toBe('DB.SCHEMA.SUBSCHEMA');
  });

  it('rejects a value with a stray quote and falls back to the default', () => {
    process.env[ENV_KEY] = 'ANALYTICS.PLATINUM"; DROP TABLE X; --';
    expect(resolveLfxOnePlatinumSchema()).toBe(DEFAULT_LFX_ONE_PLATINUM_SCHEMA);
  });

  it('rejects a value with a space and falls back to the default', () => {
    process.env[ENV_KEY] = 'A B.C';
    expect(resolveLfxOnePlatinumSchema()).toBe(DEFAULT_LFX_ONE_PLATINUM_SCHEMA);
  });

  it('rejects a value with too many segments and falls back to the default', () => {
    process.env[ENV_KEY] = 'A.B.C.D';
    expect(resolveLfxOnePlatinumSchema()).toBe(DEFAULT_LFX_ONE_PLATINUM_SCHEMA);
  });

  it('rejects a single-segment value (no schema qualifier) and falls back to the default', () => {
    process.env[ENV_KEY] = 'ANALYTICS';
    expect(resolveLfxOnePlatinumSchema()).toBe(DEFAULT_LFX_ONE_PLATINUM_SCHEMA);
  });

  it('rejects an empty/whitespace-only value and falls back to the default', () => {
    process.env[ENV_KEY] = '   ';
    expect(resolveLfxOnePlatinumSchema()).toBe(DEFAULT_LFX_ONE_PLATINUM_SCHEMA);
  });
});
