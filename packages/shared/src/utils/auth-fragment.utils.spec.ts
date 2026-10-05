// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { AUTH_FRAGMENT_KEYS, MEETING_PASSWORD_QUERY_PARAMS } from '../constants/auth-fragment.constants';
import { hasAuthFragment, redactAuthFragment, redactInviteToken, redactMeetingPassword, redactMeetingPasswordInText } from './auth-fragment.utils';

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

/** Guards the private/restricted-meeting passcode, the server's access gate, from the analytics sink. */
describe('redactMeetingPassword', () => {
  const ORIGIN = 'https://lfx.example.com';

  it.each(MEETING_PASSWORD_QUERY_PARAMS)('redacts the %s param on the meeting page, keeping every other param', (param) => {
    expect(redactMeetingPassword(`${ORIGIN}/meetings/m-1?${param}=SUPER_SECRET&tab=details`, ORIGIN)).toBe(
      `${ORIGIN}/meetings/m-1?${param}=redacted&tab=details`
    );
  });

  it('redacts on any path, including the public API a resource event records', () => {
    expect(redactMeetingPassword(`${ORIGIN}/public/api/meetings/m-1?password=SUPER_SECRET`, ORIGIN)).not.toContain('SUPER_SECRET');
    expect(redactMeetingPassword(`${ORIGIN}/public/api/meetings/m-1/join-url?password=SUPER_SECRET`, ORIGIN)).not.toContain('SUPER_SECRET');
    expect(redactMeetingPassword(`${ORIGIN}/project/acme/meetings?password=SUPER_SECRET`, ORIGIN)).not.toContain('SUPER_SECRET');
  });

  it('matches the param name case-insensitively', () => {
    expect(redactMeetingPassword(`${ORIGIN}/meetings/m-1?Password=SUPER_SECRET`, ORIGIN)).not.toContain('SUPER_SECRET');
    expect(redactMeetingPassword(`${ORIGIN}/meetings/m-1?PASSCODE=SUPER_SECRET`, ORIGIN)).not.toContain('SUPER_SECRET');
  });

  it('redacts a percent-encoded param name, at the top level and inside a nested returnTo', () => {
    expect(redactMeetingPassword(`${ORIGIN}/meetings/m-1?%70assword=SUPER_SECRET`, ORIGIN)).not.toContain('SUPER_SECRET');
    expect(redactMeetingPassword(`/login?returnTo=${encodeURIComponent('/meetings/m-1?%70asscode=SUPER_SECRET')}`, ORIGIN)).not.toContain('SUPER_SECRET');
  });

  it('redacts every occurrence of a repeated param', () => {
    expect(redactMeetingPassword(`${ORIGIN}/meetings/m-1?password=AAA&password=BBB`, ORIGIN)).toBe(`${ORIGIN}/meetings/m-1?password=redacted`);
  });

  it('resolves a relative URL against the base and keeps it relative', () => {
    expect(redactMeetingPassword('/meetings/m-1?password=SUPER_SECRET#join', ORIGIN)).toBe('/meetings/m-1?password=redacted#join');
  });

  it('redacts a meeting URL carried in returnTo, as the login redirect does', () => {
    const login = `/login?returnTo=${encodeURIComponent(`${ORIGIN}/meetings/m-1?password=SUPER_SECRET`)}`;

    expect(redactMeetingPassword(login, ORIGIN)).not.toContain('SUPER_SECRET');
    expect(new URL(redactMeetingPassword(login, ORIGIN), ORIGIN).searchParams.get('returnTo')).toBe(`${ORIGIN}/meetings/m-1?password=redacted`);
  });

  it('redacts a login returnTo nested again in the auth-error redirect, where the passcode is double-encoded', () => {
    const login = `/login?returnTo=${encodeURIComponent('/meetings/m-1?password=SUPER_SECRET')}`;
    const authError = `${ORIGIN}/auth-error?reason=session&returnTo=${encodeURIComponent(login)}`;
    const redacted = redactMeetingPassword(authError, ORIGIN);

    expect(redacted).not.toContain('SUPER_SECRET');
    const innerLogin = new URL(redacted).searchParams.get('returnTo') as string;
    expect(new URL(innerLogin, ORIGIN).searchParams.get('returnTo')).toBe('/meetings/m-1?password=redacted');
  });

  it.each([
    ['no query string', `${ORIGIN}/meetings/m-1`],
    ['unrelated params', `${ORIGIN}/meetings?token=keep-me&tab=past`],
    ['a param that merely contains the name', `${ORIGIN}/settings?password_reset=sent`],
    ['a returnTo with no passcode', `/login?returnTo=${encodeURIComponent('/meetings/m-1')}`],
    ['a nested returnTo with an unrelated query', `/login?returnTo=${encodeURIComponent('/meetings?tab=past')}`],
    ['a param value that is not a URL', `${ORIGIN}/search?q=${encodeURIComponent('a?b=1')}`],
  ])('leaves a URL with %s untouched', (_label, url) => {
    expect(redactMeetingPassword(url, ORIGIN)).toBe(url);
  });

  it('drops the query string when the URL cannot be parsed but still carries a passcode param', () => {
    expect(redactMeetingPassword('http://[not a url?password=SUPER_SECRET')).not.toContain('SUPER_SECRET');
  });
});

describe('redactMeetingPasswordInText', () => {
  it('redacts every passcode param quoted in free text, such as an HTTP error message', () => {
    const message = 'Http failure response for https://lfx.example.com/meetings/m-1?tab=a&Password=AAA: 403. Retried /x?passcode=BBB#y';
    const redacted = redactMeetingPasswordInText(message);

    expect(redacted).not.toContain('AAA');
    expect(redacted).not.toContain('BBB');
    expect(redacted).toBe('Http failure response for https://lfx.example.com/meetings/m-1?tab=a&Password=redacted 403. Retried /x?passcode=redacted#y');
  });

  it('redacts a percent-encoded param name, which only URL parsing decodes', () => {
    expect(redactMeetingPasswordInText('GET /meetings/m-1?%70assword=SUPER_SECRET failed')).toBe('GET /meetings/m-1?password=redacted failed');
  });

  it('redacts a passcode nested in a single- or double-encoded returnTo', () => {
    const login = `/login?returnTo=${encodeURIComponent('/meetings/m-1?password=SUPER_SECRET')}`;
    const authError = `https://lfx.example.com/auth-error?reason=session&returnTo=${encodeURIComponent(login)}`;

    expect(redactMeetingPasswordInText(`Navigation to ${login} failed`)).not.toContain('SUPER_SECRET');
    expect(redactMeetingPasswordInText(`Navigation to ${login} failed`)).toMatch(/^Navigation to \/login\?returnTo=\S+ failed$/);
    expect(redactMeetingPasswordInText(`Navigation to "${authError}" failed`)).not.toContain('SUPER_SECRET');
  });

  it('redacts an encoded passcode in text that does not parse as a URL, keeping the params after it', () => {
    expect(redactMeetingPasswordInText('bad value: meetings%3Fpassword%3DSUPER_SECRET%26tab%3Dpast')).toBe(
      'bad value: meetings%3Fpassword%3Dredacted%26tab%3Dpast'
    );
    expect(redactMeetingPasswordInText('bad value: meetings%253Fpasscode%253DSUPER_SECRET%2526tab')).toBe(
      'bad value: meetings%253Fpasscode%253Dredacted%2526tab'
    );
  });

  it('leaves stack frames without a passcode untouched, coordinates included', () => {
    const stack = 'Error: boom\n    at f (https://lfx.example.com/main-ABC.js?v=2:10:5)\n    at g (/chunk-XYZ.js:1:99)';
    expect(redactMeetingPasswordInText(stack)).toBe(stack);
  });

  it('leaves text without a passcode param untouched', () => {
    const text = 'Failed to reset password: password_reset=sent?ok';
    expect(redactMeetingPasswordInText(text)).toBe(text);
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
