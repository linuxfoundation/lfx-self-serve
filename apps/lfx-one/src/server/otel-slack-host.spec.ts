// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Deep relative import (not the `@lfx-one/shared/constants` barrel) — the barrel re-triggers the
// Angular JIT-compilation failure this app's other server specs mock around (it re-exports
// modules with transitive Angular imports elsewhere in the package); this single constants file
// has no such transitive import, so importing it directly for real is safe here.
import { SLACK_INCOMING_WEBHOOK_URL_PATTERN } from '../../../../packages/shared/src/constants/committees.constants';

/**
 * otel.mjs's ignoreRequestHook hard-codes the 'hooks.slack.com' host as a literal — duplicated
 * from SLACK_INCOMING_WEBHOOK_URL_PATTERN because otel.mjs runs as a dependency-free bootstrap and
 * can't import the shared package (see both files' own comments for the full rationale). Until
 * now the only thing keeping them in sync was a prose comment on each side.
 *
 * Reads otel.mjs as text (importing it would boot the OTel SDK) to extract the host it suppresses,
 * then asserts that host is actually accepted by the real, imported SLACK_INCOMING_WEBHOOK_URL_PATTERN
 * — a behavioral check, not a string-literal comparison, so it survives the regex being reformatted
 * and still catches a one-sided host edit, instead of silently reopening the credential leak this
 * carve-out exists to close (LFXV2-3080).
 */
describe('otel.mjs Slack-webhook host stays in sync with SLACK_INCOMING_WEBHOOK_URL_PATTERN', () => {
  it("otel.mjs's suppressed host is accepted by the real webhook URL allowlist", () => {
    const otelSource = readFileSync(new URL('../../otel.mjs', import.meta.url), 'utf8');
    // Anchored on `ignoreRequestHook:` so a future, unrelated `hostname === '...'` check added
    // elsewhere in the file can't silently retarget this assertion.
    const ignoreHookMatch = otelSource.match(/ignoreRequestHook:[\s\S]*?hostname === '([^']+)'/);
    const otelHost = ignoreHookMatch?.[1];

    expect(otelHost).toBeTruthy();
    expect(SLACK_INCOMING_WEBHOOK_URL_PATTERN.test(`https://${otelHost}/services/T1/B1/abc`)).toBe(true);
    // otel.mjs suppresses exactly one host. The behavioral check above alone wouldn't catch a
    // second host being added to the pattern (e.g. via an alternation) — otel's host would still
    // pass, but a second webhook host would now be allowlisted with nothing suppressing spans for
    // it. This is the other failure mode the pattern's own doc comment calls out by name.
    expect(SLACK_INCOMING_WEBHOOK_URL_PATTERN.source).not.toContain('|');
  });
});
