// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MENTORSHIP_LFX_PROFILE_EMAIL_MAX,
  MENTORSHIP_LFX_PROFILE_LOGO_URL_MAX,
  MENTORSHIP_LFX_PROFILE_NAME_MAX,
} from '../constants/mentorship-lfx-profile-card.constants';
import type { LfxProfileEmail, LfxProfileSummary, MentorshipLfxProfileFields } from '../interfaces/mentorship-lfx-profile-card.interface';
import type { EnrichedIdentity } from '../interfaces/profile.interface';
import type { CombinedProfile, EmailManagementData, UserMetadata } from '../interfaces/user-profile.interface';
import { isValidEmail } from './email.utils';

/**
 * The user's handle on `provider`, rendered verbatim as `identity.value`.
 *
 * `inAuth0` is required, matching the profile panel's GitHub row: CDP also
 * surfaces accounts it merely *suspects* belong to this person, and the card
 * presents its rows as the user's own to a program admin. An unclaimed guess
 * has no business on that list.
 */
function resolveSocialHandleLabel(identities: EnrichedIdentity[], provider: 'github' | 'linkedin'): string | null {
  const match = identities.find((identity) => identity.platform?.trim().toLowerCase() === provider && identity.inAuth0 && identity.value?.trim());
  return match?.value.trim() ?? null;
}

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
 * rather than refuse to render. `identities` is `null` when that fetch failed,
 * which is distinct from an empty list: Connect is only offered once we know
 * the account is actually unlinked.
 */
export function buildLfxProfileSummary(
  combined: CombinedProfile | null,
  emailData: EmailManagementData | null,
  identities: EnrichedIdentity[] | null = []
): LfxProfileSummary {
  const knownIdentities = identities ?? [];
  return {
    name: resolveDisplayName(combined),
    avatarUrl: combined?.profile?.picture?.trim() ?? '',
    emails: resolveEmails(combined, emailData),
    addressLines: formatLfxMailingAddress(combined?.profile),
    phone: combined?.profile?.phone_number?.trim() ?? '',
    github: resolveSocialHandleLabel(knownIdentities, 'github'),
    linkedin: resolveSocialHandleLabel(knownIdentities, 'linkedin'),
    identitiesAvailable: identities !== null,
  };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Why each set LFX profile field cannot be copied onto a mentorship profile, keyed by field. The
 * browser drops those values before sending (`buildMentorshipLfxProfileFields`) and the BFF refuses
 * them with a 400, so both apply the same rules: a name that is not blank and within its cap, an
 * email-shaped email within its cap, and an `https` logo URL within its cap. Values are checked as
 * given; the callers trim first.
 */
export function getMentorshipLfxProfileFieldErrors(fields: MentorshipLfxProfileFields): Partial<Record<keyof MentorshipLfxProfileFields, string>> {
  const errors: Partial<Record<keyof MentorshipLfxProfileFields, string>> = {};
  if (fields.firstName !== undefined && (!fields.firstName || fields.firstName.length > MENTORSHIP_LFX_PROFILE_NAME_MAX)) {
    errors.firstName = `First name must be 1 to ${MENTORSHIP_LFX_PROFILE_NAME_MAX} characters.`;
  }
  if (fields.lastName !== undefined && (!fields.lastName || fields.lastName.length > MENTORSHIP_LFX_PROFILE_NAME_MAX)) {
    errors.lastName = `Last name must be 1 to ${MENTORSHIP_LFX_PROFILE_NAME_MAX} characters.`;
  }
  if (fields.email !== undefined && (fields.email.length > MENTORSHIP_LFX_PROFILE_EMAIL_MAX || !isValidEmail(fields.email))) {
    errors.email = 'Email must be a valid email address.';
  }
  if (fields.logoUrl !== undefined && (fields.logoUrl.length > MENTORSHIP_LFX_PROFILE_LOGO_URL_MAX || !isHttpsUrl(fields.logoUrl))) {
    errors.logoUrl = `Logo URL must be an https URL of ${MENTORSHIP_LFX_PROFILE_LOGO_URL_MAX} characters or fewer.`;
  }
  return errors;
}

/**
 * The LFX profile fields a mentorship profile copies, from the values the profile card shows. Each
 * value is trimmed; a missing, blank or invalid one is left out rather than sent, since an absent
 * key leaves the stored field as it is and a bad value would only fail the whole write.
 */
export function buildMentorshipLfxProfileFields(source: { [K in keyof MentorshipLfxProfileFields]?: string | null }): MentorshipLfxProfileFields {
  const fields: MentorshipLfxProfileFields = {};
  for (const key of ['firstName', 'lastName', 'email', 'logoUrl'] as const) {
    const value = source[key]?.trim();
    if (value) fields[key] = value;
  }
  const errors = getMentorshipLfxProfileFieldErrors(fields);
  for (const key of Object.keys(errors) as (keyof MentorshipLfxProfileFields)[]) {
    delete fields[key];
  }
  return fields;
}
