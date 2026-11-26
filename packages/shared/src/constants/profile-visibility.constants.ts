// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Section-level public-profile visibility, mirroring the myprofile "visibility" preference
// (`Name='visibility'`, `Type='json'`). Each key gates one public-profile section. See LFXV2-2629.

/**
 * Ordered visibility keys — drawer render order (`basic` parent, then its children, then activity
 * sections). Declared `as const` so the union type can be derived from it.
 */
export const PROFILE_VISIBILITY_KEYS = [
  'basic',
  'aboutMe',
  'personalInfo',
  'technical_contribution',
  'community_roles',
  'event_activities',
  'training_activities',
  'certification_activities',
  'badges',
  'skills',
] as const;

/**
 * Sections enabled when a profile is switched to public (the `basic` group), matching myprofile's
 * `updatePreferenceOnUpdateIsPublic`. Making a profile private zeroes everything.
 */
export const PROFILE_VISIBILITY_PUBLIC_DEFAULT_KEYS = ['basic', 'aboutMe', 'personalInfo'] as const;

/**
 * All-false default map: the merge target when parsing the stored preference (so missing keys never
 * leak) and the reset target when a profile is made private. Fails closed — absent means hidden.
 */
export const PROFILE_VISIBILITY_DEFAULTS: Readonly<Record<(typeof PROFILE_VISIBILITY_KEYS)[number], boolean>> = {
  basic: false,
  aboutMe: false,
  personalInfo: false,
  technical_contribution: false,
  community_roles: false,
  event_activities: false,
  training_activities: false,
  certification_activities: false,
  badges: false,
  skills: false,
};

/**
 * Per-key UI metadata for the drawer (label + helper description). `parent` marks a child section so
 * the drawer indents it under `basic`. Labels follow the PublicProfile redesign "Sections" tab.
 */
export const PROFILE_VISIBILITY_SECTIONS: readonly {
  key: (typeof PROFILE_VISIBILITY_KEYS)[number];
  name: string;
  description: string;
  parent?: (typeof PROFILE_VISIBILITY_KEYS)[number];
}[] = [
  { key: 'basic', name: 'General profile information', description: 'Name, title, affiliation, and avatar shown on your public profile.' },
  { key: 'aboutMe', name: 'About me', description: 'Your long-form bio.', parent: 'basic' },
  { key: 'personalInfo', name: 'Personal information', description: 'Location and other personal details.', parent: 'basic' },
  { key: 'technical_contribution', name: 'Project contributions', description: 'Commits, pull requests, and issues across projects.' },
  { key: 'community_roles', name: 'Committees & groups', description: 'Committee and group memberships and roles.' },
  { key: 'event_activities', name: 'Event speaking', description: 'Talks and sessions you have presented at events.' },
  { key: 'training_activities', name: 'Training enrollment', description: 'Training programs you have enrolled in or completed.' },
  { key: 'certification_activities', name: 'Certifications', description: 'Certifications you have earned.' },
  { key: 'badges', name: 'Badges', description: 'Credentialing badges earned across projects.' },
  { key: 'skills', name: 'Skills', description: 'Skills listed on your profile.' },
];

/**
 * Segmented Private/Public options for the drawer's master-flag control. `value` is the boolean the
 * `isPublic` form control binds to (false = Private, true = Public).
 */
export const PROFILE_VISIBILITY_MODE_OPTIONS: readonly { label: string; value: boolean }[] = [
  { label: 'Private', value: false },
  { label: 'Public', value: true },
];

/** user-service preference `Name` for the section-visibility map. The S3 pipeline matches on this. */
export const VISIBILITY_PREFERENCE_NAME = 'visibility';

/** user-service preference `AppName`. Preserved from myprofile so the existing pipeline keeps matching. */
export const VISIBILITY_PREFERENCE_APP_NAME = 'myprofile';

/** Copy for the Profile page's Open Profile settings drawer (#6087), behind the profile redesign flag. */
export const PROFILE_SETTINGS_DRAWER_COPY = {
  title: 'Open Profile settings',
  subtitle:
    'Control whether your contributor profile is publicly visible and which sections it exposes. Changes take effect the next time your public profile is regenerated.',
  visibilityTitle: 'Profile visibility',
  visibilityDescription: 'When private, your profile is hidden and no sections are exposed.',
  visibilityLabel: 'Profile visibility',
  private: 'Private',
  public: 'Public',
  copyLink: 'Copy link',
  open: 'Open',
  tabsLabel: 'Open Profile settings',
  blocksTab: 'Blocks',
  personalTab: 'Personal data',
  cancel: 'Cancel',
  save: 'Save changes',
  nowPublic: 'Your profile is now public',
  nowPrivate: 'Your profile is now private',
  saved: 'Open Profile settings saved',
  copied: 'Public profile link copied to clipboard.',
  copyFailed: "Couldn't copy the link.",
  loading: 'Loading your Open Profile settings…',
  loadFailed: "Couldn't load your Open Profile settings.",
  retry: 'Try again',
  saveFailed: "Couldn't save your Open Profile settings. Please try again.",
  readOnly: 'You are viewing this profile while impersonating another user, so these settings are read-only.',
  impersonationBlocked: 'Visibility changes are unavailable while impersonating another user.',
} as const;
