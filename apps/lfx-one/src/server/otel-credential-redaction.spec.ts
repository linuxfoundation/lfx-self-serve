// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Without OTEL_EXPORTER_OTLP_ENDPOINT the module only logs that tracing is disabled, so importing it here is side-effect free.
const { MENTOR_INVITE_UPSTREAM_PATH, redactCredentialUrl } = await import('../../otel.mjs');

describe('otel.mjs invite-token redaction', () => {
  it.each([
    ['/mentorship/mentor/invites?token=SUPER.SECRET', '/mentorship/mentor/invites?token=redacted'],
    ['/mentorship/mentor/invites/?token=SUPER.SECRET&x=1', '/mentorship/mentor/invites/?token=redacted&x=1'],
    ['/invite?token=SUPER_SECRET', '/invite?token=redacted'],
  ])('redacts the token on a credential page: %s', (url, expected) => {
    expect(redactCredentialUrl(url)).toBe(expected);
  });

  it('redacts an invite URL carried in returnTo', () => {
    const redacted = redactCredentialUrl(`/login?returnTo=${encodeURIComponent('/mentorship/mentor/invites?token=SUPER.SECRET')}`);

    expect(redacted).not.toContain('SECRET');
    expect(new URL(redacted, 'http://localhost').searchParams.get('returnTo')).toBe('/mentorship/mentor/invites?token=redacted');
  });

  it.each(['/meetings?token=keep', '/mentorship/mentor/programs', `/login?returnTo=${encodeURIComponent('/meetings')}`])('leaves %s unchanged', (url) => {
    expect(redactCredentialUrl(url)).toBe(url);
  });

  it('suppresses outgoing spans for the upstream mentor-invite path the BFF calls', () => {
    const service = readFileSync(new URL('./services/mentorship-mentor.service.ts', import.meta.url), 'utf8');
    const constants = readFileSync(new URL('./constants/mentorship.constants.ts', import.meta.url), 'utf8');

    expect(service).toContain('MENTORSHIP_MENTOR_INVITES_PATH}/${encodeURIComponent(token)}');
    expect(constants).toContain(`MENTORSHIP_MENTOR_INVITES_PATH = '${MENTOR_INVITE_UPSTREAM_PATH.slice(0, -1)}'`);
  });
});
