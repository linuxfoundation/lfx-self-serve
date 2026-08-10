// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * otel.mjs's ignoreRequestHook and SLACK_INCOMING_WEBHOOK_URL_PATTERN
 * (packages/shared/src/constants/committees.constants.ts) both hard-code the
 * 'hooks.slack.com' host — duplicated because otel.mjs runs as a dependency-free bootstrap and
 * can't import the shared package (see both files' own comments for the full rationale). Until
 * now the only thing keeping them in sync was a prose comment on each side. Reads both files as
 * text (not as modules — importing otel.mjs would boot the OTel SDK, and importing the real
 * `@lfx-one/shared/constants` barrel here re-triggers the Angular JIT-compilation failure this
 * app's other server specs mock around) and asserts the host literal each one hard-codes is
 * identical, so a one-sided edit fails loudly instead of silently reopening the credential leak
 * this carve-out exists to close (LFXV2-3080).
 */
describe('otel.mjs Slack-webhook host stays in sync with SLACK_INCOMING_WEBHOOK_URL_PATTERN', () => {
  it('hard-codes the same host in both places', () => {
    const otelSource = readFileSync(new URL('../../otel.mjs', import.meta.url), 'utf8');
    const constantsSource = readFileSync(new URL('../../../../packages/shared/src/constants/committees.constants.ts', import.meta.url), 'utf8');

    const otelHostMatch = otelSource.match(/hostname === '([^']+)'/);
    // The pattern's source is a regex literal, so its host segment is written with escaped
    // slashes/dots (e.g. `\/\/hooks\.slack\.com\/services`) — capture everything between the
    // scheme and `\/services`, then strip the backslash-escapes to get the plain host string.
    const patternHostMatch = constantsSource.match(/SLACK_INCOMING_WEBHOOK_URL_PATTERN = \/\^https:\\\/\\\/([\s\S]+?)\\\/services/);
    const patternHost = patternHostMatch?.[1]?.replace(/\\/g, '');

    expect(otelHostMatch?.[1]).toBeTruthy();
    expect(patternHost).toBeTruthy();
    expect(otelHostMatch?.[1]).toBe(patternHost);
  });
});
