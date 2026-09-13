// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { LFX_PROFILE_SOCIAL_LINKS } from '../constants/mentorship-lfx-profile-card.constants';

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
export type LfxProfileSocialProvider = keyof typeof LFX_PROFILE_SOCIAL_LINKS;

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
  github: LfxProfileLink | null;
  linkedin: LfxProfileLink | null;
}
