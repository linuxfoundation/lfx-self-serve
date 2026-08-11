// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Deep relative import (not the `@lfx-one/shared/constants` barrel) — the barrel re-exports
// modules with transitive Angular imports elsewhere in the shared package, which this app's
// server-side vitest config isn't wired to compile; this single constants file has no such
// transitive import, so importing it directly for real is safe here (same pattern as
// project.controller.spec.ts's routes-drift guard).
import { SLACK_INCOMING_WEBHOOK_URL_PATTERN } from '../../../../packages/shared/src/constants/committees.constants';

/**
 * otel.mjs's ignoreRequestHook hard-codes the 'hooks.slack.com' host as a literal — duplicated
 * from SLACK_INCOMING_WEBHOOK_URL_PATTERN because otel.mjs runs as a dependency-free bootstrap and
 * can't import the shared package (see both files' own comments for the full rationale). Until
 * now the only thing keeping them in sync was a prose comment on each side.
 *
 * Both checks below are behavioral (they exercise the real, imported pattern against sample URLs)
 * rather than comparing regex source text, so they survive the regex being reformatted and don't
 * depend on any particular spelling (alternation, an optional group, a character class, …) of a
 * host-widening edit.
 */
describe('otel.mjs Slack-webhook host stays in sync with SLACK_INCOMING_WEBHOOK_URL_PATTERN', () => {
  const otelSource = readFileSync(new URL('../../otel.mjs', import.meta.url), 'utf8');
  // Anchored on `ignoreRequestHook:` so a future, unrelated `hostname === '...'` check added
  // elsewhere in the file can't silently retarget this assertion.
  const otelHost = otelSource.match(/ignoreRequestHook:[\s\S]*?hostname === '([^']+)'/)?.[1];

  it('otel.mjs actually extracted a host to suppress', () => {
    expect(otelHost).toBeTruthy();
  });

  it("otel.mjs's suppressed host is accepted by the real webhook URL allowlist", () => {
    expect(SLACK_INCOMING_WEBHOOK_URL_PATTERN.test(`https://${otelHost}/services/T1/B1/abc`)).toBe(true);
  });

  it('the allowlist accepts no host other than the one otel.mjs suppresses', () => {
    // A representative sample of ways the pattern could be widened to admit a second host — not
    // an exhaustive proof (deciding a regex's full accepted-host set isn't tractable here), but it
    // catches the realistic shapes: an optional/extra character, a sibling TLD, and an unrelated
    // Slack-owned domain. Any of these being accepted means a webhook host exists that otel.mjs
    // (which only skips `otelHost`) would export unredacted.
    const otherHosts = ['hook.slack.com', 'hooks.slack.com.evil.example', 'hooks.slack-gov.com', 'api.slack.com', 'evil.example'];
    for (const host of otherHosts) {
      expect(SLACK_INCOMING_WEBHOOK_URL_PATTERN.test(`https://${host}/services/T1/B1/abc`), `${host} is allowlisted but not suppressed by otel.mjs`).toBe(
        false
      );
    }
  });
});
