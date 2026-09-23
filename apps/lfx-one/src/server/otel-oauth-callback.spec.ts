// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('OTel Gateway callback credential protection', () => {
  const source = readFileSync(new URL('../../otel.mjs', import.meta.url), 'utf8');
  const hook = source.match(/ignoreIncomingRequestHook:[\s\S]*?(?=,\s*applyCustomAttributesOnSpan)/)?.[0] ?? '';
  const pattern = hook.match(/if \(\/(.+)\/([a-z]*)\.test\(url\)\) return true;/);
  if (!pattern) throw new Error('Missing OAuth callback tracing exclusion');
  const excluded = new RegExp(pattern[1], pattern[2]);

  it.each(['/api-gateway/callback?code=SECRET&state=SECRET', '/api-gateway/callback/?code=SECRET', '/API-GATEWAY/CALLBACK?error_description=SECRET'])(
    'does not send the credential-bearing URL to tracing: %s',
    (url) => {
      expect(excluded.test(url)).toBe(true);
    }
  );

  it.each(['/api/projects?name=synthetic', '/org/acme/easycla', '/api-gateway/auth/start', '/callback-other', '/crowdfunding/callback', '/callback'])(
    'preserves tracing for ordinary requests: %s',
    (url) => {
      expect(excluded.test(url)).toBe(false);
    }
  );
});
