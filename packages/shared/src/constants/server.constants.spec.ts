// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { SENSITIVE_FIELDS } from './server.constants';

/**
 * Reimplements logger.service.ts's sanitize() key-matching (`key.toLowerCase().includes(field)`)
 * rather than exercising it — `packages/shared` cannot import from `apps/lfx-one` (one-way
 * dependency direction), so this can only pin SENSITIVE_FIELDS' *contents*, not the redaction
 * behavior itself. If sanitize()'s matching algorithm changes independently of this list, this
 * test won't notice; see logger.service.spec.ts's 'redacts chat_webhook_url' case for the test
 * that actually exercises sanitize() and would catch that.
 */
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
