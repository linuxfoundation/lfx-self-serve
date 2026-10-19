// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn() }));
// valkey.service.ts (reached through the session service) needs only these two modules from the
// utils barrel, which otherwise pulls in @angular/forms. As in gatewaze-session.service.spec.ts.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/identity.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-selector.utils')),
}));

import { GW_EMBED_STYLESHEET_KEY_PATTERN } from '@lfx-one/shared/constants';

import { buildGwRuntimeConfig } from './gw-runtime-config.helper';

const req = { path: '/' } as Request;

describe('buildGwRuntimeConfig', () => {
  beforeEach(() => {
    vi.stubEnv('LFX_GATEWAZE_HOST_SESSION', 'true');
    vi.stubEnv('LFX_GATEWAZE_EMBED_ENABLED', 'true');
    vi.stubEnv('SESSION_STORE_ENABLED', 'true');
    vi.stubEnv('VALKEY_URL', 'redis://valkey.example.test:6379');
    vi.stubEnv('GW_SUPABASE_URL', 'https://supabase.example.test');
    vi.stubEnv('GW_SUPABASE_ANON_KEY', 'sb_publishable_synthetic');
    vi.stubEnv('PCC_AUTH0_SECRET', 'synthetic-secret');
    vi.stubEnv('GW_EMBED_URL', 'https://admin.example.test/embed');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('sets gwHostSession when host-session mode is on and fully configured', () => {
    expect(buildGwRuntimeConfig(req)).toEqual({
      gwSupabaseUrl: 'https://supabase.example.test',
      gwSupabaseAnonKey: 'sb_publishable_synthetic',
      gwEmbedUrl: 'https://admin.example.test/embed',
      gwHostSession: true,
      gwEmbedStylesheetKey: expect.stringMatching(GW_EMBED_STYLESHEET_KEY_PATTERN),
    });
  });

  it('works out no stylesheet key while host-session mode is off, since the outlet never mounts then', async () => {
    vi.stubEnv('LFX_GATEWAZE_HOST_SESSION', '');
    const helper = await import('./gw-embed.helper');
    const getKey = vi.spyOn(helper, 'getGwEmbedStylesheetKey');

    expect(buildGwRuntimeConfig(req).gwEmbedStylesheetKey).toBe('');
    expect(getKey).not.toHaveBeenCalled();
  });

  it('withholds the stylesheet key, rather than failing the page, when the theme cannot be read', async () => {
    const helper = await import('./gw-embed.helper');
    vi.spyOn(helper, 'getGwEmbedStylesheetKey').mockImplementation(() => {
      throw new Error('theme unavailable');
    });

    expect(buildGwRuntimeConfig(req).gwEmbedStylesheetKey).toBe('');
  });

  it.each([
    ['the flag is off', 'LFX_GATEWAZE_HOST_SESSION', ''],
    ['the session store is off', 'SESSION_STORE_ENABLED', 'false'],
    ['the anon key is not publishable', 'GW_SUPABASE_ANON_KEY', 'sb_secret_synthetic'],
  ])('clears gwHostSession when %s', (_label, name, value) => {
    vi.stubEnv(name, value);

    expect(buildGwRuntimeConfig(req).gwHostSession).toBe(false);
  });
});
