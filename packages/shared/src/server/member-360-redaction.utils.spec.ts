// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { createMember360Redactor } from './member-360-redaction.utils';

describe('Member 360 exact contact redaction', () => {
  it('ignores short values and placeholders and preserves words containing a contact', () => {
    const redact = createMember360Redactor(['—', 'A', 'TBD', 'n/a', 'ant']);
    expect(redact('caféant anté ant')).toBe('caféant anté [contact redacted]');
    expect(redact('Annual grant report: TBD, n/a, A — ant; email team@example.test.')).toBe(
      'Annual grant report: TBD, n/a, A — [contact redacted]; email [contact redacted].'
    );
  });
  it.each(['', '@', '@example.test'])(
    'redacts a 10k punctuation run with suffix %s within a bounded time',
    (suffix) => {
      const text = '!'.repeat(10000) + suffix;
      const started = performance.now();
      expect(createMember360Redactor([])(text)).toBe(suffix === '@example.test' ? '[contact redacted]' : text);
      expect(performance.now() - started).toBeLessThan(500);
    },
    1000
  );
  it('handles long non-email runs and preserves punctuation around consecutive emails', () => {
    const redact = createMember360Redactor([]);
    expect(redact('a'.repeat(100000))).toHaveLength(100000);
    expect(redact('(one@example.test), two@sub.example.test. bad@host @example.test')).toBe('([contact redacted]), [contact redacted]. bad@host @example.test');
  });
  it('unions original email and exact-contact spans without exposing the rest of an address', () => {
    expect(createMember360Redactor(['Kim'])('Reach mia@Kim.test')).toBe('Reach [contact redacted]');
    expect(createMember360Redactor(['Kim', 'owner@example.test: follow'])('Kim; owner@example.test: follow up.')).toBe(
      '[contact redacted]; [contact redacted] up.'
    );
  });
  it('escapes regex punctuation and matches complete contact values at text boundaries', () => {
    const redact = createMember360Redactor(['opaque-person (team), contact@example.test']);
    expect(redact('opaque-person (team), contact@example.test: follow up.')).toBe('[contact redacted]: follow up.');
    expect(redact('No contact details here.')).toBe('No contact details here.');
  });
});
