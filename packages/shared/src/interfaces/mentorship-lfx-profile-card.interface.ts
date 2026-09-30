// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * One address on the "From Your LFX Profile" card. `isPrimary` marks the
 * address auth-service returns as `primary_email`; the rest are alternates.
 */
export interface LfxProfileEmail {
  email: string;
  isPrimary: boolean;
}

/**
 * Read-only projection of the signed-in user's LFX profile, as shown by the
 * "From Your LFX Profile" card. Assembled by `buildLfxProfileSummary` from the
 * three sources that own these fields — the profile, the email list, and the
 * connected identities — so the card holds no derivation logic of its own.
 *
 * Every field is display-ready: missing data is an empty string, empty array,
 * or null, and the card renders its own placeholder for those. Initials are
 * absent because `lfx-avatar` takes `name` and derives its own letter from it,
 * and the fallback color is absent because the card styles that itself.
 */
export interface LfxProfileSummary {
  name: string;
  avatarUrl: string;
  emails: LfxProfileEmail[];
  addressLines: string[];
  phone: string;
  github: string | null;
  linkedin: string | null;
  /**
   * False when the identities endpoint failed, as opposed to returning an empty list.
   * Connect must not be offered in that case: a linked account would look missing and a
   * click would start OAuth that ends in `already_linked` after discarding the form.
   */
  identitiesAvailable: boolean;
}

/**
 * The LFX profile fields a mentorship profile copies, as the "From Your LFX Profile" card shows
 * them. Sent with the mentor and mentee registrations and by the card's sync after an Edit LFX
 * Profile save. A key is absent when the card has no usable value for it: nothing here clears a
 * stored field, so a card that loaded only part of the profile cannot blank the rest.
 */
export interface MentorshipLfxProfileFields {
  firstName?: string;
  lastName?: string;
  email?: string;
  /** An `https` URL: the avatar the card shows. */
  logoUrl?: string;
}

/**
 * The same fields as `MentorshipLfxProfileFields`, in the upstream profile's column names. Part of
 * the `PUT /mentorship/v1/me/profiles/{profileType}` bodies, and the whole
 * `PATCH /mentorship/v1/me/profiles/by-id/{id}` body the sync sends.
 */
export interface MentorshipUpstreamLfxProfileFields {
  first_name?: string;
  last_name?: string;
  email?: string;
  logo_url?: string;
}
