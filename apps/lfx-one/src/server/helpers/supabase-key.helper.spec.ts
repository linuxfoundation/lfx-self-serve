// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isPublishableSupabaseKey } from './supabase-key.helper';

/**
 * GW_SUPABASE_ANON_KEY is serialized into the SSR payload of every page, so a service-role key
 * pasted there would publish RLS-bypassing database access to anyone who views source. Only the
 * variable's name stood between those outcomes, and pasting the wrong value from the Supabase
 * dashboard is an ordinary mistake that produces a working app and no feedback at all.
 */
describe('isPublishableSupabaseKey', () => {
  const jwt = (payload: Record<string, unknown>): string =>
    `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

  it('publishes a legacy anon JWT', () => {
    expect(isPublishableSupabaseKey(jwt({ role: 'anon', iss: 'supabase' }))).toBe(true);
  });

  it('withholds a legacy service-role JWT', () => {
    expect(isPublishableSupabaseKey(jwt({ role: 'service_role', iss: 'supabase' }))).toBe(false);
  });

  it('withholds a modern sb_secret_ key, which carries no claims to inspect', () => {
    expect(isPublishableSupabaseKey('sb_secret_abc123')).toBe(false);
  });

  it('publishes a modern sb_publishable_ key', () => {
    expect(isPublishableSupabaseKey('sb_publishable_abc123')).toBe(true);
  });

  it('does not reject an anon key that merely contains the words service_role in its blob', () => {
    // Why the role is read from decoded claims rather than matched against the whole token: the
    // string can appear incidentally in base64, and matching on it would fail valid keys at random.
    // The single-char pad aligns `service_role` to a 3-byte boundary so it survives base64 intact —
    // proving the token really does contain the literal string a naive match would have caught.
    const key = jwt({ role: 'anon', note: 'xservice_role' });
    expect(key).toContain('c2VydmljZV9yb2xl');
    expect(isPublishableSupabaseKey(key)).toBe(true);
  });

  it('withholds a three-part token whose claims will not decode', () => {
    // About to be handed to every browser that loads the page — not a value to guess about.
    expect(isPublishableSupabaseKey('not.valid.jwt')).toBe(false);
  });

  it.each([
    ['leading whitespace', ' sb_secret_abc123'],
    ['trailing whitespace', 'sb_secret_abc123 '],
    ['a newline', '\nsb_secret_abc123\n'],
  ])('still withholds a secret key with %s', (_label, key) => {
    // Without trimming, the prefix check misses, the value falls through as an "unrecognised
    // format", and gets published — while whatever consumes it downstream trims it back off.
    expect(isPublishableSupabaseKey(key)).toBe(false);
  });

  it('withholds a service-role JWT padded with whitespace', () => {
    const padded = `  ${jwt({ role: 'service_role' })}  `;
    expect(isPublishableSupabaseKey(padded)).toBe(false);
  });

  it('treats a whitespace-only value as nothing to publish', () => {
    expect(isPublishableSupabaseKey('   ')).toBe(false);
  });

  it('treats an empty value as nothing to publish', () => {
    expect(isPublishableSupabaseKey('')).toBe(false);
  });

  it('publishes an unrecognised non-JWT format rather than breaking a future key type', () => {
    // Deliberately a denylist of the two known-privileged shapes: Supabase has changed key formats
    // once already, and an allowlist would turn off a working deployment for a key never unsafe.
    expect(isPublishableSupabaseKey('some-future-format-key')).toBe(true);
  });
});
