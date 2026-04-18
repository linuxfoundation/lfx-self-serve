// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import type { FilterPillOption } from '../interfaces';

export const BADGE_LABEL = {
  singular: 'Badge',
  plural: 'Badges',
} as const;

export const BADGE_FILTER_OPTIONS: FilterPillOption[] = [
  { id: 'all', label: 'All' },
  { id: 'certifications', label: 'Certifications' },
  { id: 'learning', label: 'Learning' },
  { id: 'memberships', label: 'Memberships' },
  { id: 'speaking', label: 'Speaking' },
  { id: 'event-participation', label: 'Event Participation' },
  { id: 'contributors', label: 'Contributors' },
  { id: 'program-committee', label: 'Program Committee' },
];

export const BADGE_STATUS_FILTER_OPTIONS: FilterPillOption[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'active', label: 'Active' },
  { id: 'expired', label: 'Expired' },
];

export const BADGE_VISIBILITY_FILTER_OPTIONS: FilterPillOption[] = [
  { id: 'all', label: 'All' },
  { id: 'public', label: 'Public' },
  { id: 'private', label: 'Private' },
];

export const BADGE_STATUS_SELECT_OPTIONS = BADGE_STATUS_FILTER_OPTIONS.map((o) => ({ label: o.label, value: o.id }));

export const BADGE_VISIBILITY_SELECT_OPTIONS = BADGE_VISIBILITY_FILTER_OPTIONS.map((o) => ({ label: o.label, value: o.id }));
