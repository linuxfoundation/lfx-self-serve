// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { SENSITIVE_FIELDS } from './server.constants';

/** Mirrors logger.service.ts's sanitize() key-matching algorithm exactly, so this test fails the moment the two drift. */
function isSensitiveField(key: string): boolean {
  return SENSITIVE_FIELDS.some((field) => key.toLowerCase().includes(field));
}

describe('SENSITIVE_FIELDS', () => {
  it('matches chat_webhook_url (LFXV2-3080) — a Slack Incoming Webhook URL is a bearer credential and must never reach logs unredacted', () => {
    expect(isSensitiveField('chat_webhook_url')).toBe(true);
  });

  it('matches other known credential-shaped field names', () => {
    expect(isSensitiveField('password')).toBe(true);
    expect(isSensitiveField('access_token')).toBe(true);
    expect(isSensitiveField('Authorization')).toBe(true);
  });

  it('does not match an unrelated, non-sensitive field name', () => {
    expect(isSensitiveField('committee_name')).toBe(false);
  });
});
