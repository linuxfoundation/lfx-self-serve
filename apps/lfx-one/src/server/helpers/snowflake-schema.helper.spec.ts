// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The `@lfx-one/shared/*` alias isn't wired into this app's vitest config (see
// committee-engagement.service.spec.ts / committee-engagement-window.helper.spec.ts for the same
// note), and the constants barrel pulls in transitive imports that don't survive outside an
// Angular build/test context. Deep-import the real constant, by relative path — same idiom
// project.service.spec.ts uses for a deep shared import — so the helper under test resolves
// whatever production resolves. The assertions below still pin the literal value, not this
// import, so a change to the default schema fails this suite instead of both sides silently
// moving together.
vi.mock('@lfx-one/shared/constants', async () => {
  const actual = await vi.importActual<typeof import('../../../../../packages/shared/src/constants/org-lens-projects.constants')>(
    '../../../../../packages/shared/src/constants/org-lens-projects.constants'
  );
  return { DEFAULT_LFX_ONE_PLATINUM_SCHEMA: actual.DEFAULT_LFX_ONE_PLATINUM_SCHEMA };
});

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
    expect(resolveLfxOnePlatinumSchema()).toBe('ANALYTICS.PLATINUM_LFX_ONE');
  });

  it('accepts a well-formed two-segment override, normalized to uppercase', () => {
    process.env[ENV_KEY] = 'analytics.custom_schema';
    expect(resolveLfxOnePlatinumSchema()).toBe('ANALYTICS.CUSTOM_SCHEMA');
  });

  it('rejects a three-segment override and falls back to the default — every call site appends a table name unconditionally, so a 3-segment schema would produce an invalid 4-part identifier', () => {
    process.env[ENV_KEY] = 'DB.SCHEMA.SUBSCHEMA';
    expect(resolveLfxOnePlatinumSchema()).toBe('ANALYTICS.PLATINUM_LFX_ONE');
  });

  it('rejects a value with a stray quote and falls back to the default', () => {
    process.env[ENV_KEY] = 'ANALYTICS.PLATINUM"; DROP TABLE X; --';
    expect(resolveLfxOnePlatinumSchema()).toBe('ANALYTICS.PLATINUM_LFX_ONE');
  });

  it('rejects a value with a space and falls back to the default', () => {
    process.env[ENV_KEY] = 'A B.C';
    expect(resolveLfxOnePlatinumSchema()).toBe('ANALYTICS.PLATINUM_LFX_ONE');
  });

  it('rejects a value with too many segments and falls back to the default', () => {
    process.env[ENV_KEY] = 'A.B.C.D';
    expect(resolveLfxOnePlatinumSchema()).toBe('ANALYTICS.PLATINUM_LFX_ONE');
  });

  it('rejects a single-segment value (no schema qualifier) and falls back to the default', () => {
    process.env[ENV_KEY] = 'ANALYTICS';
    expect(resolveLfxOnePlatinumSchema()).toBe('ANALYTICS.PLATINUM_LFX_ONE');
  });

  it('rejects an empty/whitespace-only value and falls back to the default', () => {
    process.env[ENV_KEY] = '   ';
    expect(resolveLfxOnePlatinumSchema()).toBe('ANALYTICS.PLATINUM_LFX_ONE');
  });
});
