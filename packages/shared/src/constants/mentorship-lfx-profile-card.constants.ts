// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const LFX_PROFILE_CARD_TITLE = 'From Your LFX Profile';
export const LFX_PROFILE_CARD_SUBTITLE = 'Your name, avatar, email, mailing address, phone number and connected accounts are used from your LFX account.';
export const LFX_PROFILE_CARD_EDIT_LABEL = 'Edit LFX Profile';

/**
 * Tooltip shown on the Edit button when the profile endpoint failed to load, explaining
 * why the control is disabled rather than leaving the mentor guessing.
 */
export const LFX_PROFILE_CARD_EDIT_DISABLED_TOOLTIP = 'Your profile could not be loaded, so editing is unavailable. Try reloading the page.';

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
 * Why Connect is disabled while impersonating: the link would attach the account to the
 * impersonator, not the user whose profile the card is showing. Word-for-word the Identities
 * tab's explanation for the same affordance, so the two surfaces read alike.
 */
export const LFX_PROFILE_CARD_CONNECT_IMPERSONATING_LABEL = 'This action is unavailable while impersonating another user';

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
 * Caps on the LFX profile fields a mentorship profile copies. The browser drops a name or logo URL
 * past its cap rather than send it, and the BFF refuses one with a 400, so neither can store an
 * oversize value. The BFF leaves out a resolved primary email past its cap.
 */
export const MENTORSHIP_LFX_PROFILE_NAME_MAX = 100;
export const MENTORSHIP_LFX_PROFILE_EMAIL_MAX = 254;
export const MENTORSHIP_LFX_PROFILE_LOGO_URL_MAX = 2048;

/** Shown when the LFX profile saved but copying it onto the mentorship profile failed. */
export const LFX_PROFILE_CARD_MENTORSHIP_SYNC_FAILED_SUMMARY = 'Mentorship profile not updated';
export const LFX_PROFILE_CARD_MENTORSHIP_SYNC_FAILED_DETAIL =
  'Your LFX profile was saved, but your mentorship profile still shows the old name, email or picture. Save your LFX profile again to retry.';
