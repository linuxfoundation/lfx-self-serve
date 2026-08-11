// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { SLACK_INCOMING_WEBHOOK_URL_IN_TEXT_PATTERN, SLACK_INCOMING_WEBHOOK_URL_PATTERN } from './committees.constants';

/**
 * Tests the real, imported constant — not a hand-copied regex literal in a test's own mock, the
 * way the server/app-side specs necessarily stub it (`@lfx-one/shared/*` isn't wired into their
 * vitest config). If someone loosens the real pattern, this is the one place that actually
 * notices; the mocked copies elsewhere would keep passing against the old, safe behavior.
 */
describe('SLACK_INCOMING_WEBHOOK_URL_PATTERN', () => {
  it('accepts a well-formed Slack incoming webhook URL', () => {
    expect(SLACK_INCOMING_WEBHOOK_URL_PATTERN.test('https://hooks.slack.com/services/T000/B000/XXXX')).toBe(true);
  });

  it('rejects a non-Slack host entirely', () => {
    expect(SLACK_INCOMING_WEBHOOK_URL_PATTERN.test('https://evil.example.com/services/T1/B1/X')).toBe(false);
  });

  it('rejects a userinfo bypass (https://hooks.slack.com@evil.example/...)', () => {
    expect(SLACK_INCOMING_WEBHOOK_URL_PATTERN.test('https://hooks.slack.com@evil.example/services/T1/B1/X')).toBe(false);
  });

  it('rejects a path-prefix bypass (https://evil.example/hooks.slack.com/services/...)', () => {
    expect(SLACK_INCOMING_WEBHOOK_URL_PATTERN.test('https://evil.example/hooks.slack.com/services/T1/B1/X')).toBe(false);
  });

  it('rejects a subdomain bypass (https://hooks.slack.com.evil.example/...)', () => {
    expect(SLACK_INCOMING_WEBHOOK_URL_PATTERN.test('https://hooks.slack.com.evil.example/services/T1/B1/X')).toBe(false);
  });

  it('rejects plain http (no TLS)', () => {
    expect(SLACK_INCOMING_WEBHOOK_URL_PATTERN.test('http://hooks.slack.com/services/T1/B1/X')).toBe(false);
  });

  it('rejects a trailing-newline / embedded-content bypass', () => {
    expect(SLACK_INCOMING_WEBHOOK_URL_PATTERN.test('https://hooks.slack.com/services/T1/B1/X\nhttps://evil.example')).toBe(false);
  });

  it('rejects a URL missing the /services/T.../B.../... path shape', () => {
    expect(SLACK_INCOMING_WEBHOOK_URL_PATTERN.test('https://hooks.slack.com/')).toBe(false);
    expect(SLACK_INCOMING_WEBHOOK_URL_PATTERN.test('https://hooks.slack.com/services/')).toBe(false);
    expect(SLACK_INCOMING_WEBHOOK_URL_PATTERN.test('https://hooks.slack.com/services/T1/B1/')).toBe(false);
  });
});

describe('SLACK_INCOMING_WEBHOOK_URL_IN_TEXT_PATTERN', () => {
  it('strips a webhook URL embedded in arbitrary surrounding text', () => {
    const redacted = 'fetch failed: https://hooks.slack.com/services/T000/B000/XXXX unreachable'.replace(
      SLACK_INCOMING_WEBHOOK_URL_IN_TEXT_PATTERN,
      '[redacted-url]'
    );
    expect(redacted).toBe('fetch failed: [redacted-url] unreachable');
  });

  it('strips every occurrence when the URL appears more than once', () => {
    const redacted = 'https://hooks.slack.com/services/T1/B1/X and again https://hooks.slack.com/services/T2/B2/Y'.replace(
      SLACK_INCOMING_WEBHOOK_URL_IN_TEXT_PATTERN,
      '[redacted-url]'
    );
    expect(redacted).not.toContain('hooks.slack.com');
  });

  it('leaves text with no embedded webhook URL unchanged', () => {
    const text = 'fetch failed: connect ETIMEDOUT';
    expect(text.replace(SLACK_INCOMING_WEBHOOK_URL_IN_TEXT_PATTERN, '[redacted-url]')).toBe(text);
  });
});
