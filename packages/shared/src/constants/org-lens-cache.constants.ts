// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CompactSeatRow, SeatCommittee } from '../interfaces/org-lens-cache.interface';
import type { OrgAllEmployeeRow } from '../interfaces/org-people.interface';

/**
 * Stored column lists for the compact per-caller Org Lens caches (GH-1906).
 *
 * Each list is also a guard contract: a cached entry whose table does not carry exactly this ordered
 * column set is rejected as a miss rather than decoded, so a changed list must come with a namespace
 * bump in `VALKEY_CACHE`.
 */

/** Columns of the `org-seats` committee dictionary — every field that repeats across a committee's seats. */
export const ORG_SEATS_CACHE_COMMITTEE_KEYS = [
  'committee_uid',
  'committee_name',
  'committee_category',
  'project_uid',
  'project_slug',
  'organization_id',
] as const satisfies readonly (keyof SeatCommittee)[];

/**
 * Columns of an `org-seats` seat row. `avatar` is kept deliberately: it looks unread to a naive
 * search, but `resolveSeatAvatar` prefers it and only derives a URL from `username` when it is
 * absent, so dropping it would silently downgrade every real avatar to the fallback.
 */
export const ORG_SEATS_CACHE_SEAT_KEYS = [
  'c',
  'uid',
  'first_name',
  'last_name',
  'email',
  'job_title',
  'role_name',
  'voting_status',
  'appointed_by',
  'is_org_editable',
  'reason',
  'avatar',
  'username',
] as const satisfies readonly (keyof CompactSeatRow)[];

/**
 * Columns of an `org-people-dir` row, in `toWireRow`'s own field order. The exact list is what
 * asserts the merge-only fields (`emails`, `mergedFrom`) are never stored, and the matching order is
 * what makes a cache hit serialize byte-for-byte like the miss that populated it.
 */
export const ORG_PEOPLE_DIRECTORY_CACHE_ROW_KEYS = [
  'personKey',
  'lfid',
  'lfUsername',
  'cdpMemberId',
  'name',
  'firstName',
  'lastName',
  'title',
  'email',
  'accessBadge',
  'avatarUrl',
  'sources',
  'seatsCount',
  'boardSeatsCount',
  'committeeSeatsCount',
  'commitsCount',
  'eventsCount',
  'coursesCount',
  'engagedFoundationIds',
] as const satisfies readonly (keyof OrgAllEmployeeRow)[];
