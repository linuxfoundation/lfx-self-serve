// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { AUTH_FRAGMENT_KEYS } from '../constants/auth-fragment.constants';
import { hasAuthFragment, redactAuthFragment, redactInviteToken } from './auth-fragment.utils';

/**
 * Guards Supabase access AND refresh tokens from reaching a third-party analytics sink. A refresh
 * token is long-lived, so a leak here does not expire on its own.
 */
describe('redactAuthFragment', () => {
  const ORIGIN = 'https://lfx.example.com';

  it.each(AUTH_FRAGMENT_KEYS)('redacts a fragment carrying %s', (key) => {
    const redacted = redactAuthFragment(`${ORIGIN}/project/gw/newsletters?project=aaif#${key}=SUPER_SECRET&expires_in=3600`);

    expect(redacted).not.toContain('SUPER_SECRET');
    expect(redacted).toBe(`${ORIGIN}/project/gw/newsletters?project=aaif#redacted`);
  });

  it('redacts the whole fragment when several auth keys are present, not just the first', () => {
    const redacted = redactAuthFragment(`${ORIGIN}/x#access_token=AAA&refresh_token=BBB`);

    expect(redacted).not.toContain('AAA');
    expect(redacted).not.toContain('BBB');
  });

  it('resolves a relative URL against the base so a same-origin referrer is still redacted', () => {
    expect(redactAuthFragment('/relative/path#refresh_token=SECRET', ORIGIN)).not.toContain('SECRET');
  });

  it.each([
    ['no fragment at all', `${ORIGIN}/project/gw/newsletters`],
    ['a plain anchor', `${ORIGIN}/docs#section-heading`],
    ['a fragment with no auth key', `${ORIGIN}/x#expires_in=3600&token_type=bearer`],
  ])('leaves a URL with %s untouched', (_label, url) => {
    // Over-redacting would blind the analytics this is meant to keep useful.
    expect(redactAuthFragment(url)).toBe(url);
  });

  it('drops the fragment wholesale when the URL cannot be parsed, rather than passing it through', () => {
    expect(redactAuthFragment('http://[not a url#access_token=SECRET')).not.toContain('SECRET');
  });
});

describe('redactInviteToken', () => {
  const ORIGIN = 'https://lfx.example.com';

  it('redacts the token query param on /invite and /invite/error', () => {
    expect(redactInviteToken(`${ORIGIN}/invite?token=SUPER_SECRET`, ORIGIN)).toBe(`${ORIGIN}/invite?token=redacted`);
    expect(redactInviteToken(`${ORIGIN}/invite/error?reason=failed&token=SUPER_SECRET`, ORIGIN)).not.toContain('SUPER_SECRET');
  });

  it('resolves a relative invite URL against the base', () => {
    expect(redactInviteToken('/invite?token=SUPER_SECRET', ORIGIN)).not.toContain('SUPER_SECRET');
  });

  it('leaves non-invite URLs and invite URLs without a token untouched', () => {
    expect(redactInviteToken(`${ORIGIN}/meetings?token=keep-me`, ORIGIN)).toBe(`${ORIGIN}/meetings?token=keep-me`);
    expect(redactInviteToken(`${ORIGIN}/invite`, ORIGIN)).toBe(`${ORIGIN}/invite`);
  });

  it('drops the query string when the URL cannot be parsed but still carries a token param', () => {
    expect(redactInviteToken('http://[not a url?token=SUPER_SECRET')).not.toContain('SUPER_SECRET');
  });

  it('redacts an invite URL carried in returnTo, as the login and auth-error redirects do', () => {
    const login = `/login?returnTo=${encodeURIComponent('/mentorship/mentor/invites?token=SUPER.SECRET')}`;
    const authError = `${ORIGIN}/auth-error?reason=session&returnTo=${encodeURIComponent('/invite?token=SUPER_SECRET')}`;

    expect(redactInviteToken(login, ORIGIN)).not.toContain('SECRET');
    expect(new URL(redactInviteToken(login, ORIGIN), ORIGIN).searchParams.get('returnTo')).toBe('/mentorship/mentor/invites?token=redacted');
    expect(redactInviteToken(authError, ORIGIN)).not.toContain('SECRET');
    expect(redactInviteToken(`/login?returnTo=${encodeURIComponent('/meetings?token=keep')}`, ORIGIN)).toBe(
      `/login?returnTo=${encodeURIComponent('/meetings?token=keep')}`
    );
  });

  it('redacts the token on the mentorship mentor-invite page, keeping a relative URL relative', () => {
    expect(redactInviteToken(`${ORIGIN}/mentorship/mentor/invites?token=SUPER.SECRET`, ORIGIN)).toBe(`${ORIGIN}/mentorship/mentor/invites?token=redacted`);
    expect(redactInviteToken('/mentorship/mentor/invites/?token=SUPER.SECRET', ORIGIN)).toBe('/mentorship/mentor/invites/?token=redacted');
    expect(redactInviteToken(`${ORIGIN}/mentorship/mentor/programs?token=keep-me`, ORIGIN)).toBe(`${ORIGIN}/mentorship/mentor/programs?token=keep-me`);
  });
});

describe('hasAuthFragment', () => {
  it('is false for an empty hash', () => {
    expect(hasAuthFragment('')).toBe(false);
  });

  it('tolerates a leading # and detects the key either way', () => {
    expect(hasAuthFragment('#access_token=x')).toBe(true);
    expect(hasAuthFragment('access_token=x')).toBe(true);
  });

  it('does not match a key that merely contains an auth key as a substring', () => {
    expect(hasAuthFragment('#not_access_token=x')).toBe(false);
  });
});
