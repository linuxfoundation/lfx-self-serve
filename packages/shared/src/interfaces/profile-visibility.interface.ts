// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PROFILE_VISIBILITY_KEYS } from '../constants/profile-visibility.constants';

/** One section-visibility key (e.g. `'basic'`, `'badges'`). Derived from the ordered key list. */
export type ProfileVisibilityKey = (typeof PROFILE_VISIBILITY_KEYS)[number];

/** Boolean map over every section key — `true` means the section is exposed on the public profile. */
export type ProfileVisibilitySections = Record<ProfileVisibilityKey, boolean>;

/**
 * Resolved public-profile visibility (from `GET /api/profile/visibility`): the master `isPublic`
 * flag, the merged `sections` map, and `preferenceId` (`null` until the first save creates it).
 */
export interface ProfileVisibility {
  isPublic: boolean;
  sections: ProfileVisibilitySections;
  preferenceId: string | null;
}

/** Request body for `PATCH /api/profile/visibility`. The client sends the fully resolved state. */
export interface ProfileVisibilityUpdateRequest {
  isPublic: boolean;
  sections: ProfileVisibilitySections;
}

/**
 * A single user-service preference record. PascalCase matches the upstream `preferences` contract
 * (casing must be preserved). `Value` is a string — for `Type: 'json'` it holds stringified JSON.
 */
export interface UserServicePreference {
  ID: string;
  AppName: string;
  Name: string;
  Description?: string;
  System: boolean;
  Type: 'text' | 'json' | 'integer';
  Value: string;
}

/** List envelope returned by `GET /user-service/v1/users/{id}/preferences`. */
export interface UserServicePreferenceList {
  Data: UserServicePreference[];
}
