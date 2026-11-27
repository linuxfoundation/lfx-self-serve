// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Year-selector value on the public profile that means "all yearly rows summed" (no single year). */
export const PUBLIC_PROFILE_ALL_YEARS = 0;

export const PUBLIC_PROFILE_ALL_YEARS_LABEL = 'All years';

/** Browser storage key for a visitor's public profile theme, light or dark, under the profile redesign (#6091). */
export const PUBLIC_PROFILE_THEME_STORAGE_KEY = 'lfx-public-profile-theme';

/** Copy for the redesigned public profile's Foundations & projects involvement (#6093). */
export const PUBLIC_PROFILE_INVOLVEMENT_COPY = {
  contributor: 'Contributor',
  untitled: 'Untitled project',
  commits: 'Commits',
  prs: 'PRs',
  issues: 'Issues',
} as const;

/** Start of a badge's accessible name on the redesigned public profile, numbered since the data carries no badge name (#6092). */
export const PUBLIC_PROFILE_BADGE_LABEL = 'Credly badge';
