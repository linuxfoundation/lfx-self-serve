// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { CombinedProfile, MeetingInviteEmail, User } from '../interfaces';
import { buildMeetingSelfGuest, isMeetingSelfGuestListed } from './meeting-self-guest.utils';

const session = (overrides: Partial<User> = {}): User => ({
  sid: 'synthetic-session',
  sub: 'auth0|synthetic-session-user',
  nickname: 'session-lfid',
  name: 'Session Claims',
  updated_at: '2026-01-01T00:00:00Z',
  email_verified: true,
  email: 'session@example.com',
  given_name: 'Session',
  family_name: 'Claims',
  picture: 'https://avatars.example.com/session.png',
  'https://sso.linuxfoundation.org/claims/username': 'session-lfid',
  ...overrides,
});

const profile = (overrides: { user?: Partial<CombinedProfile['user']>; profile?: CombinedProfile['profile'] } = {}): CombinedProfile => ({
  user: {
    id: 'auth0|1',
    email: 'primary@example.com',
    first_name: 'Profile',
    last_name: 'Person',
    username: 'profile-lfid',
    created_at: '',
    updated_at: '',
    ...overrides.user,
  },
  profile:
    overrides.profile === undefined
      ? { job_title: 'Engineer', organization: 'Profile Org', picture: 'https://avatars.example.com/profile.png' }
      : overrides.profile,
});

const invite = (email: string | null): MeetingInviteEmail => ({ email_id: email ? 'email-1' : null, email });

describe('buildMeetingSelfGuest', () => {
  it('invites the meeting-invite email over the primary email', () => {
    const guest = buildMeetingSelfGuest(session(), profile(), invite('invites@example.com'), null);

    expect(guest?.email).toBe('invites@example.com');
  });

  it('falls back to the primary email when there is no invite preference', () => {
    expect(buildMeetingSelfGuest(session(), profile(), invite(null), null)?.email).toBe('primary@example.com');
    expect(buildMeetingSelfGuest(session(), profile(), null, null)?.email).toBe('primary@example.com');
  });

  it('builds the guest from the profile when every source is present', () => {
    expect(buildMeetingSelfGuest(session(), profile(), null, null)).toEqual({
      email: 'primary@example.com',
      first_name: 'Profile',
      last_name: 'Person',
      job_title: 'Engineer',
      org_name: 'Profile Org',
      username: 'profile-lfid',
      avatar_url: 'https://avatars.example.com/profile.png',
      matchEmails: ['primary@example.com', 'session@example.com'],
    });
  });

  it('uses the session claims alone when every lookup failed', () => {
    expect(buildMeetingSelfGuest(session(), null, null, null)).toEqual({
      email: 'session@example.com',
      first_name: 'Session',
      last_name: 'Claims',
      job_title: null,
      org_name: null,
      username: 'session-lfid',
      avatar_url: 'https://avatars.example.com/session.png',
      matchEmails: ['session@example.com'],
    });
  });

  it('takes names from the profile metadata before the session when the profile user has none', () => {
    const guest = buildMeetingSelfGuest(
      session(),
      profile({ user: { first_name: null, last_name: null }, profile: { given_name: 'Meta', family_name: 'Data' } }),
      null,
      null
    );

    expect(guest?.first_name).toBe('Meta');
    expect(guest?.last_name).toBe('Data');
  });

  it('lower-cases and de-duplicates the match emails', () => {
    const guest = buildMeetingSelfGuest(
      session({ email: 'Primary@Example.com' }),
      profile({ user: { email: 'PRIMARY@example.com' } }),
      invite(' Invites@Example.com '),
      null
    );

    expect(guest?.email).toBe('Invites@Example.com');
    expect(guest?.matchEmails).toEqual(['invites@example.com', 'primary@example.com']);
  });

  it('prefers the current employer over the profile organization', () => {
    expect(buildMeetingSelfGuest(session(), profile(), null, 'Employer Corp')?.org_name).toBe('Employer Corp');
  });

  it('returns null when no source has an email', () => {
    expect(buildMeetingSelfGuest(session({ email: '' }), profile({ user: { email: '' } }), invite(null), null)).toBeNull();
    expect(buildMeetingSelfGuest(null, null, null, null)).toBeNull();
  });

  it('leaves names empty when no source has them', () => {
    const guest = buildMeetingSelfGuest(
      session({ given_name: '', family_name: '' }),
      profile({ user: { first_name: null, last_name: null }, profile: null }),
      null,
      null
    );

    expect(guest?.first_name).toBe('');
    expect(guest?.last_name).toBe('');
  });
});

describe('isMeetingSelfGuestListed', () => {
  const self = { matchEmails: ['invites@example.com', 'primary@example.com'], username: 'pdoe' };

  it('matches any known email in any case', () => {
    expect(isMeetingSelfGuestListed(self, [{ email: ' Primary@Example.com ', username: null }])).toBe(true);
  });

  it('matches the LFID when the guest is listed under another address', () => {
    expect(isMeetingSelfGuestListed(self, [{ email: 'work@example.com', username: 'PDoe' }])).toBe(true);
  });

  it('is false when neither an email nor the LFID matches', () => {
    expect(isMeetingSelfGuestListed(self, [{ email: 'someone@example.com', username: 'someone' }])).toBe(false);
  });

  it('never matches on a missing email or LFID', () => {
    expect(isMeetingSelfGuestListed({ matchEmails: ['primary@example.com'], username: null }, [{ email: null, username: null }])).toBe(false);
    expect(isMeetingSelfGuestListed({ matchEmails: ['primary@example.com'], username: null }, [{ email: '', username: 'pdoe' }])).toBe(false);
  });
});
