// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const LFX_PROFILE_CARD_TITLE = 'From Your LFX Profile';
export const LFX_PROFILE_CARD_SUBTITLE = 'Your name, avatar, email, mailing address, phone number and connected accounts are used from your LFX account.';
export const LFX_PROFILE_CARD_EDIT_LABEL = 'Edit LFX Profile';
export const LFX_PROFILE_CARD_PRIMARY_BADGE = 'Primary';

/** Shown in place of a field the profile has not filled in. */
export const LFX_PROFILE_CARD_EMPTY = 'Not provided';

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
