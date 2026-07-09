// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgMeetingPrivacy } from '../interfaces';

/**
 * Deterministic UI-only placeholder for "is the viewer invited to this private meeting".
 * LFXV2-1901 is scoped to UI only — the real invite-membership check lands in a follow-up
 * ticket. Deterministic (hashed off the meeting id) so the same meeting always renders the
 * same way across re-fetches instead of flickering between states.
 */
export function deriveDemoViewerInvited(meetingId: string): boolean {
  let hash = 0;
  for (const char of meetingId) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return hash % 3 !== 0;
}

/** Deterministic UI-only placeholder for a private meeting's join password (see `deriveDemoViewerInvited`). */
export function deriveDemoPassword(meetingId: string, privacy: OrgMeetingPrivacy): string | null {
  return privacy === 'private' ? `demo-${meetingId}` : null;
}

/** Builds the demo "See Details" route + query params for a meeting (real routing target, placeholder password param). */
export function deriveDemoDetailsUrl(meetingId: string, password: string | null): string {
  return password ? `/meetings/${meetingId}/details?password=${encodeURIComponent(password)}` : `/meetings/${meetingId}/details`;
}
