// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { reqSerializer } from './server-logger';

describe('Gateway callback request logging', () => {
  it.each(['/api-gateway/callback', '/api-gateway/callback/', '/API-GATEWAY/CALLBACK'])(
    'does not serialize authorization codes, state, or provider descriptions on %s',
    (path) => {
      const req = {
        originalUrl: `${path}?code=SECRET-CODE&state=SECRET-STATE&error_description=SECRET-DESCRIPTION`,
        headers: {},
      } as Parameters<typeof reqSerializer>[0];
      const serialized = reqSerializer(req);
      expect(serialized.url).toBe(path);
      expect(JSON.stringify(serialized)).not.toContain('SECRET');
    }
  );

  it.each(['/api/projects?name=synthetic', '/crowdfunding/callback?unrelated=value', '/callback?unrelated=value'])(
    'leaves existing logging unchanged: %s',
    (url) => {
      const req = { url, headers: {} } as Parameters<typeof reqSerializer>[0];
      expect(reqSerializer(req).url).toBe(url);
    }
  );
});
