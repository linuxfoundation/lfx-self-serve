// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { EnrichedIdentity } from '../interfaces/profile.interface';
import type { CombinedProfile, EmailManagementData, UserMetadata } from '../interfaces/user-profile.interface';
import { buildLfxProfileSummary, formatLfxMailingAddress } from './mentorship-lfx-profile-card.utils';

function combinedProfile(user: Partial<CombinedProfile['user']> = {}, profile: UserMetadata | null = null): CombinedProfile {
  return {
    user: {
      id: 'u_1',
      email: 'ada@example.org',
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'ada',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      ...user,
    },
    profile,
  };
}

function identity(platform: string, value: string, inAuth0 = true): EnrichedIdentity {
  return {
    id: `id_${platform}`,
    platform,
    type: 'username',
    value,
    verified: true,
    source: 'cdp',
    icon: '',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    displayState: 'verified',
    inAuth0,
  };
}

describe('buildLfxProfileSummary', () => {
  it('assembles the card from the profile, the email list, and the connected identities', () => {
    const emails: EmailManagementData = {
      primary_email: 'ada@example.org',
      alternate_emails: [{ email: 'ada@work.example', verified: true }],
    };
    const profile: UserMetadata = {
      picture: 'https://cdn.example.org/ada.png',
      address: '1 Analytical Way',
      city: 'London',
      state_province: 'Greater London',
      postal_code: 'NW1 1AA',
      country: 'United Kingdom',
      phone_number: '+44 20 7946 0000',
    };

    const summary = buildLfxProfileSummary(combinedProfile({}, profile), emails, [identity('github', 'ada'), identity('linkedin', 'ada-lovelace')]);

    expect(summary).toEqual({
      name: 'Ada Lovelace',
      avatarUrl: 'https://cdn.example.org/ada.png',
      emails: [
        { email: 'ada@example.org', isPrimary: true },
        { email: 'ada@work.example', isPrimary: false },
      ],
      addressLines: ['1 Analytical Way', 'London, Greater London, NW1 1AA, United Kingdom'],
      phone: '+44 20 7946 0000',
      github: { label: 'github.com/ada', url: 'https://github.com/ada' },
      linkedin: { label: 'linkedin.com/in/ada-lovelace', url: 'https://linkedin.com/in/ada-lovelace' },
    });
  });

  it('prefers the name the user typed into their profile over the account first/last', () => {
    expect(buildLfxProfileSummary(combinedProfile({}, { name: 'A. Lovelace' }), null).name).toBe('A. Lovelace');
  });

  it('falls back through username and then the email local part so the name is never blank', () => {
    expect(buildLfxProfileSummary(combinedProfile({ first_name: null, last_name: null }), null).name).toBe('ada');
    expect(buildLfxProfileSummary(combinedProfile({ first_name: null, last_name: null, username: null }), null).name).toBe('ada');
    expect(buildLfxProfileSummary(combinedProfile({ first_name: null, last_name: null, username: '  ' }), null).name).toBe('ada');
  });

  it('shows the signed-in address when the email endpoint fails, rather than an empty section', () => {
    expect(buildLfxProfileSummary(combinedProfile(), null).emails).toEqual([{ email: 'ada@example.org', isPrimary: true }]);
  });

  it('does not list an address twice when it is returned as both primary and alternate', () => {
    const emails: EmailManagementData = {
      primary_email: 'ada@example.org',
      // Same address, different case — a duplicate row is still a duplicate.
      alternate_emails: [
        { email: 'Ada@Example.org', verified: true },
        { email: 'ada@work.example', verified: true },
      ],
    };

    expect(buildLfxProfileSummary(combinedProfile(), emails).emails).toEqual([
      { email: 'ada@example.org', isPrimary: true },
      { email: 'ada@work.example', isPrimary: false },
    ]);
  });

  it('reads a handle stored as a full URL without doubling the host', () => {
    const summary = buildLfxProfileSummary(combinedProfile(), null, [
      identity('GitHub', 'https://github.com/ada/'),
      identity('linkedin', 'linkedin.com/in/ada-lovelace'),
    ]);

    expect(summary.github).toEqual({ label: 'github.com/ada', url: 'https://github.com/ada' });
    expect(summary.linkedin).toEqual({ label: 'linkedin.com/in/ada-lovelace', url: 'https://linkedin.com/in/ada-lovelace' });
  });

  it('leaves a platform null when the user has no identity on it', () => {
    const summary = buildLfxProfileSummary(combinedProfile(), null, [identity('github', '  ')]);

    expect(summary.github).toBeNull();
    expect(summary.linkedin).toBeNull();
  });

  it('ignores an account CDP only suspects is theirs, since the card presents these to an admin as their own', () => {
    const summary = buildLfxProfileSummary(combinedProfile(), null, [identity('github', 'someone-else', false)]);

    expect(summary.github).toBeNull();
  });

  it('degrades field by field when every source is unavailable', () => {
    expect(buildLfxProfileSummary(null, null)).toMatchObject({
      name: '',
      avatarUrl: '',
      emails: [],
      addressLines: [],
      phone: '',
      github: null,
      linkedin: null,
    });
  });
});

describe('formatLfxMailingAddress', () => {
  it('puts the street on its own line and everything locating it on the next', () => {
    expect(formatLfxMailingAddress({ address: '22 Bourdillon Rd', city: 'Lagos', postal_code: '106104', country: 'Nigeria' })).toEqual([
      '22 Bourdillon Rd',
      'Lagos, 106104, Nigeria',
    ]);
  });

  it('drops the segments the profile has not filled in instead of leaving stray commas', () => {
    expect(formatLfxMailingAddress({ country: 'Kenya' })).toEqual(['Kenya']);
    expect(formatLfxMailingAddress({ city: 'Nairobi', country: 'Kenya' })).toEqual(['Nairobi, Kenya']);
    expect(formatLfxMailingAddress({ city: 'Nairobi', postal_code: '00100' })).toEqual(['Nairobi, 00100']);
  });

  it('returns no lines for a profile with no address at all', () => {
    expect(formatLfxMailingAddress(null)).toEqual([]);
    expect(formatLfxMailingAddress({ address: '   ' })).toEqual([]);
  });
});
