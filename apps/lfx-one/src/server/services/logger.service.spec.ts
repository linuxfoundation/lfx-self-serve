// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { logger } from './logger.service';

describe('LoggerService.sanitize', () => {
  it('redacts chat_webhook_url (LFXV2-3080) — a Slack Incoming Webhook URL is a bearer credential', () => {
    const result = logger.sanitize({ chat_webhook_url: 'https://hooks.slack.com/services/T000/B000/XXXX', name: 'Test Committee' });

    expect(result['chat_webhook_url']).toBe('[REDACTED]');
    expect(result['name']).toBe('Test Committee');
  });

  it('redacts other known credential-shaped keys', () => {
    const result = logger.sanitize({ password: 'x', access_token: 'y', authorization: 'z' });

    expect(result).toEqual({ password: '[REDACTED]', access_token: '[REDACTED]', authorization: '[REDACTED]' });
  });

  it('leaves an unrelated key untouched', () => {
    expect(logger.sanitize({ committee_id: 'committee-1' })).toEqual({ committee_id: 'committee-1' });
  });
});
