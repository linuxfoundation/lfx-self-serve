// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LFX_PROFILE_SOCIAL_LINKS } from '../constants/mentorship-lfx-profile-card.constants';
import type { LfxProfileEmail, LfxProfileLink, LfxProfileSocialProvider, LfxProfileSummary } from '../interfaces/mentorship-lfx-profile-card.interface';
import type { EnrichedIdentity } from '../interfaces/profile.interface';
import type { CombinedProfile, EmailManagementData, UserMetadata } from '../interfaces/user-profile.interface';

/**
 * Display name, preferring the `name` the user typed into their profile over one
 * assembled from the account's first/last, then falling back to the username and
 * finally the email's local part — the card should never render a blank name.
 */
function resolveDisplayName(combined: CombinedProfile | null): string {
  const typed = combined?.profile?.name?.trim();
  if (typed) return typed;

  const assembled = [combined?.user?.first_name, combined?.user?.last_name]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
  if (assembled) return assembled;

  return combined?.user?.username?.trim() || (combined?.user?.email?.split('@')[0].trim() ?? '');
}

/**
 * Mailing address over two lines, as the design lays it out: the street, then
 * everything that locates it — city, state, postal code, country — joined by
 * commas. Empty parts are dropped, so a profile carrying only a country renders
 * one line rather than a run of stray commas.
 */
export function formatLfxMailingAddress(profile: UserMetadata | null | undefined): string[] {
  const street = profile?.address?.trim() ?? '';
  const locality = [profile?.city, profile?.state_province, profile?.postal_code, profile?.country]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(', ');

  return [street, locality].filter(Boolean);
}

/**
 * The user's handle on `provider`, as a label/url pair. CDP stores a bare
 * handle, but tolerate a value pasted as a full URL by keeping only its last
 * path segment — otherwise the href would double up the host.
 *
 * `inAuth0` is required, matching the profile panel's GitHub row: CDP also
 * surfaces accounts it merely *suspects* belong to this person, and the card
 * presents these as the user's own to a program admin. An unclaimed guess has
 * no business in that list.
 */
function resolveSocialLink(identities: EnrichedIdentity[], provider: LfxProfileSocialProvider): LfxProfileLink | null {
  const match = identities.find((identity) => identity.platform?.trim().toLowerCase() === provider && identity.inAuth0 && identity.value?.trim());
  if (!match) return null;

  const handle = match.value.trim().replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? '';
  if (!handle) return null;

  const { host, path } = LFX_PROFILE_SOCIAL_LINKS[provider];
  return { label: `${host}/${path}${handle}`, url: `https://${host}/${path}${encodeURIComponent(handle)}` };
}

/**
 * The account's addresses, primary first. Falls back to the profile's own email
 * when the email endpoint fails, so a partial outage still shows the address the
 * user signed in with instead of an empty section. De-duplicated because an
 * address listed as both primary and alternate must not render twice.
 */
function resolveEmails(combined: CombinedProfile | null, emailData: EmailManagementData | null): LfxProfileEmail[] {
  const primary = emailData?.primary_email?.trim() || combined?.user?.email?.trim() || '';
  const alternates = (emailData?.alternate_emails ?? []).map((entry) => entry.email?.trim() ?? '');

  const seen = new Set<string>();
  return [primary, ...alternates]
    .filter((email) => {
      const key = email.toLowerCase();
      if (!email || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((email) => ({ email, isPrimary: email === primary }));
}

/**
 * Builds the "From Your LFX Profile" card's data from the three endpoints that
 * own it. Each argument is nullable on purpose: the card fetches them
 * independently and lets any one fail, so this must degrade field by field
 * rather than refuse to render.
 */
export function buildLfxProfileSummary(
  combined: CombinedProfile | null,
  emailData: EmailManagementData | null,
  identities: EnrichedIdentity[] = []
): LfxProfileSummary {
  return {
    name: resolveDisplayName(combined),
    avatarUrl: combined?.profile?.picture?.trim() ?? '',
    emails: resolveEmails(combined, emailData),
    addressLines: formatLfxMailingAddress(combined?.profile),
    phone: combined?.profile?.phone_number?.trim() ?? '',
    github: resolveSocialLink(identities, 'github'),
    linkedin: resolveSocialLink(identities, 'linkedin'),
  };
}
