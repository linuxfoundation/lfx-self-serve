// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const LFX_PROFILE_CARD_TITLE = 'From Your LFX Profile';
export const LFX_PROFILE_CARD_SUBTITLE = 'Your name, avatar, email, mailing address, phone number and connected accounts are used from your LFX account.';
export const LFX_PROFILE_CARD_EDIT_LABEL = 'Edit LFX Profile';
export const LFX_PROFILE_CARD_PRIMARY_BADGE = 'Primary';

/** Shown in place of a field the profile has not filled in. */
export const LFX_PROFILE_CARD_EMPTY = 'Not provided';

/**
 * Replaces the placeholder on the GitHub and LinkedIn rows. Unlike the card's other fields, an
 * unconnected account is something the mentor can act on without leaving for the profile editor,
 * so those rows offer the link rather than telling them the value is missing.
 */
export const LFX_PROFILE_CARD_CONNECT_LABEL = 'Connect';

/**
 * Outcome copy for the account-link round trip that Connect starts. The OAuth callback returns
 * to whichever page opened the dialog and reports itself in `?success=` / `?error=`, and the
 * mentorship forms mount outside the profile shell that would otherwise announce those, so the
 * card says them itself.
 */
export const LFX_PROFILE_CARD_LINK_SUCCESS_DETAIL = 'Identity linked successfully.';
/** In neither shared error map, and the likeliest real failure — so it gets its own copy. */
export const LFX_PROFILE_CARD_LINK_ALREADY_LINKED_DETAIL =
  'That account is already linked to another LFX profile. Open Profile & Account → Identities to sort it out.';
/** Authorization succeeded but the link never ran — see the `profile_token_obtained` branch. */
export const LFX_PROFILE_CARD_LINK_INCOMPLETE_DETAIL = 'Authorization finished, but the account was not linked. Select Connect to try again.';
export const LFX_PROFILE_CARD_LINK_ERROR_FALLBACK = 'An error occurred. Please try again.';

/**
 * The card's labelled fields, in the order the design lays them out across two
 * columns. Name and emails are deliberately absent: they sit unlabelled beside
 * the avatar rather than in this grid.
 */
export const LFX_PROFILE_CARD_LABELS = {
  address: 'Mailing Address',
  phone: 'Phone',
  github: 'GitHub',
  linkedin: 'LinkedIn',
} as const;

/**
 * How a stored platform handle becomes a link. `host` doubles as the visible
 * label prefix, so the card reads `github.com/octocat` rather than a bare
 * handle; `path` is the segment LinkedIn requires before the handle.
 */
export const LFX_PROFILE_SOCIAL_LINKS = {
  github: { host: 'github.com', path: '' },
  linkedin: { host: 'linkedin.com', path: 'in/' },
} as const;
