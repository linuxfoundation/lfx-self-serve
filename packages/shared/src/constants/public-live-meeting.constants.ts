// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Meeting } from '../interfaces/meeting.interface';

/**
 * Allowlist for anonymous/guest responses from `GET /public/api/meetings/:id` — the live/upcoming
 * meeting endpoint. Deliberately tighter than `PUBLIC_ANONYMOUS_PAST_MEETING_KEYS`: a private
 * meeting reached without an authenticated session (no session at all, or a guest who only has
 * the shared password) must show title + "Join as Guest" only — no agenda, materials, or
 * date/time. A field added upstream must be named here before an anonymous/guest caller can see it.
 *
 * Kept in its own runtime-leaf file with only a type import so specs that mock the constants
 * barrel can import the real list by relative path instead of copying it.
 */
export const PUBLIC_ANONYMOUS_LIVE_MEETING_KEYS = [
  'id',
  'project_uid',
  'project_name',
  'committees',
  'title',
  'meeting_type',
  'visibility',
  'restricted',
] as const satisfies readonly (keyof Meeting)[];
