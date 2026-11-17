// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CombinedProfile, MeetingHostCandidate, MeetingInviteEmail, MeetingSelfGuest, User } from '../interfaces';

/**
 * Builds the signed-in user as a meeting guest for the "Add myself" action.
 *
 * Every source is optional: the session may be absent, and the other sources come from separate
 * lookups that may fail on their own. A missing source falls through to the next one. The invite
 * goes to the meeting-invite preference when the user set one, since that is where they asked to
 * receive meeting invitations, else to the profile's primary email, else to the session email.
 *
 * @returns `null` when no source has an email, since a guest cannot be invited without one
 */
export function buildMeetingSelfGuest(
  session: Pick<
    User,
    'email' | 'given_name' | 'family_name' | 'first_name' | 'last_name' | 'username' | 'picture' | 'https://sso.linuxfoundation.org/claims/username'
  > | null,
  profile: CombinedProfile | null,
  inviteEmail: MeetingInviteEmail | null,
  employerName: string | null
): MeetingSelfGuest | null {
  const candidateEmails = [inviteEmail?.email, profile?.user.email, session?.email].map((email) => email?.trim() ?? '');
  const email = candidateEmails.find((candidate) => candidate !== '');

  if (!email) {
    return null;
  }

  const metadata = profile?.profile ?? null;

  return {
    email,
    first_name: firstNonEmpty(profile?.user.first_name, metadata?.given_name, session?.given_name, session?.first_name) ?? '',
    last_name: firstNonEmpty(profile?.user.last_name, metadata?.family_name, session?.family_name, session?.last_name) ?? '',
    job_title: firstNonEmpty(metadata?.job_title),
    org_name: firstNonEmpty(employerName, metadata?.organization),
    username: firstNonEmpty(profile?.user.username, session?.['https://sso.linuxfoundation.org/claims/username'], session?.username),
    avatar_url: firstNonEmpty(metadata?.picture, session?.picture),
    matchEmails: [...new Set(candidateEmails.filter((candidate) => candidate !== '').map((candidate) => candidate.toLowerCase()))],
  };
}

/**
 * Whether the signed-in user is already on a guest list, so "Add myself" would invite them twice.
 * @description A guest matches on any of the user's known emails, in any case, or on their LFID the way
 * `isMeetingGuestViewer` identifies the viewer: a guest added through a group can be listed under
 * an address none of the user's lookups returned.
 */
export function isMeetingSelfGuestListed(
  self: Pick<MeetingSelfGuest, 'matchEmails' | 'username'>,
  people: readonly Pick<MeetingHostCandidate, 'email' | 'username'>[]
): boolean {
  const emails = new Set(self.matchEmails);
  const username = self.username?.trim().toLowerCase();
  return people.some((person) => emails.has(person.email?.trim().toLowerCase() ?? '') || (!!username && person.username?.trim().toLowerCase() === username));
}

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim();

    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}
