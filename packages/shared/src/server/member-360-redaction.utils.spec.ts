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
  it('escapes regex punctuation and matches complete contact values at text boundaries', () => {
    const redact = createMember360Redactor(['opaque-person (team), contact@example.test']);
    expect(redact('opaque-person (team), contact@example.test: follow up.')).toBe('[contact redacted]: follow up.');
    expect(redact('No contact details here.')).toBe('No contact details here.');
  });
});
