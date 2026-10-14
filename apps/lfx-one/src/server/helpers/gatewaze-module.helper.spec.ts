// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { authorizeGatewazeModule, gatewazeModuleForPath } from './gatewaze-module.helper';

const api = { url: 'https://api.example.test', prefix: '/api', supabase: false };
const rest = { url: 'https://supabase.example.test', prefix: '/rest/v1', supabase: true };

describe('gatewazeModuleForPath', () => {
  it.each([
    ['a module route', '/api/modules/newsletters/editions', 'newsletters'],
    ['the module root', '/api/modules/host-media', 'host-media'],
    ['a percent-encoded id', '/api/modules/ai%2Dcopilot/run', 'ai-copilot'],
    ['an upper-cased path, which the API routes case-insensitively', '/API/Modules/newsletters/x', 'newsletters'],
    ['repeated slashes, which the URL parser keeps', '/api//modules//newsletters/x', 'newsletters'],
    ['malformed encoding, kept raw', '/api/modules/%E0%A4%A/x', '%E0%A4%A'],
  ])('maps %s to its module', (_label, pathname, expected) => {
    expect(gatewazeModuleForPath(api, pathname)).toBe(expected);
  });

  it.each([
    ['an API route outside /api/modules', api, '/api/me'],
    ['the modules listing', api, '/api/modules'],
    ['a Supabase path', rest, '/rest/v1/newsletters'],
  ])('maps %s to no module', (_label, upstream, pathname) => {
    expect(gatewazeModuleForPath(upstream, pathname)).toBeNull();
  });
});

describe('authorizeGatewazeModule', () => {
  it('allows every module until entitlements are enforced, so turning enforcement on must change this test', async () => {
    await expect(authorizeGatewazeModule({} as Request, 'newsletters')).resolves.toBe(true);
  });
});
