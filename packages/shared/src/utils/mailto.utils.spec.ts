// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildMailtoUrl } from './mailto.utils';

describe('buildMailtoUrl', () => {
  it('returns null when there is no email (caller renders plain text)', () => {
    expect(buildMailtoUrl({ email: '', subject: 'Sync' })).toBeNull();
    expect(buildMailtoUrl({ email: null })).toBeNull();
  });

  it('builds a mailto with a percent-encoded subject and body, address left bare', () => {
    const href = buildMailtoUrl({ email: 'ada@example.com', subject: 'Board & Strategy', body: 'https://lfx.dev/m/1?x=1' });

    expect(href).toBe('mailto:ada@example.com?subject=Board%20%26%20Strategy&body=https%3A%2F%2Flfx.dev%2Fm%2F1%3Fx%3D1');
  });

  it('omits subject/body query parts that are empty', () => {
    expect(buildMailtoUrl({ email: 'a@b.com', subject: 'Only Subject' })).toBe('mailto:a@b.com?subject=Only%20Subject');
    expect(buildMailtoUrl({ email: 'a@b.com' })).toBe('mailto:a@b.com');
  });

  it('rejects addresses that could inject mailto headers', () => {
    expect(buildMailtoUrl({ email: 'a?subject=evil@b.com' })).toBeNull();
    expect(buildMailtoUrl({ email: 'a&cc=x@b.com' })).toBeNull();
    expect(buildMailtoUrl({ email: 'has space@b.com' })).toBeNull();
    expect(buildMailtoUrl({ email: 'no-at-sign' })).toBeNull();
    // Percent-encoded CRLF + Bcc header-injection attempt must not survive the allowlist.
    expect(buildMailtoUrl({ email: 'victim@example.com%0D%0ABcc:attacker@example.com' })).toBeNull();
    expect(buildMailtoUrl({ email: 'two@at@example.com' })).toBeNull();
  });
});
