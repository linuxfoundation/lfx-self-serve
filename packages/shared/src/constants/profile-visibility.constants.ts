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
 * Parent → children map for the drawer cascade: `basic` mirrors to its children; a child recomputes
 * `basic` as the OR of its children. One source of truth for client and any future server logic.
 */
export const PROFILE_VISIBILITY_CASCADE: Readonly<Record<string, readonly string[]>> = {
  basic: ['aboutMe', 'personalInfo'],
};

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

/** user-service preference `Name` for the section-visibility map. The S3 pipeline matches on this. */
export const VISIBILITY_PREFERENCE_NAME = 'visibility';

/** user-service preference `AppName`. Preserved from myprofile so the existing pipeline keeps matching. */
export const VISIBILITY_PREFERENCE_APP_NAME = 'myprofile';
