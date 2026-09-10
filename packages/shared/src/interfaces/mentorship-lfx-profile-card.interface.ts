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
 * A linked external profile, ready to render as an anchor: `label` is the
 * host-qualified handle shown to the user (`github.com/octocat`) and `url` is
 * where it points.
 */
export interface LfxProfileLink {
  label: string;
  url: string;
}

/** The external platforms the LFX profile card links out to. */
export type LfxProfileSocialProvider = 'github' | 'linkedin';

/**
 * Read-only projection of the signed-in user's LFX profile, as shown by the
 * "From Your LFX Profile" card. Assembled by `buildLfxProfileSummary` from the
 * three sources that own these fields — the profile, the email list, and the
 * connected identities — so the card holds no derivation logic of its own.
 *
 * Every field is display-ready: missing data is an empty string, empty array,
 * or null, and the card renders its own placeholder for those. Initials and the
 * avatar's fallback color are absent by design; `lfx-person-avatar` derives both
 * from `name` so every avatar in the app picks the same color for a person.
 */
export interface LfxProfileSummary {
  name: string;
  avatarUrl: string;
  emails: LfxProfileEmail[];
  addressLines: string[];
  phone: string;
  github: LfxProfileLink | null;
  linkedin: LfxProfileLink | null;
}
