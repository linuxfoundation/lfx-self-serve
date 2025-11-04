// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingOccurrence, MeetingRsvp, RsvpCounts } from '../interfaces/meeting.interface';

/**
 * Calculate RSVP counts for a specific occurrence
 * Takes into account RSVP scope (single, all, following) and uses the most recent RSVP per user
 *
 * @param occurrence - The meeting occurrence to calculate for (or null for non-recurring meetings)
 * @param allRsvps - All RSVPs for the meeting
 * @param meetingStartTime - The meeting start time (for non-recurring meetings)
 * @returns Object with accepted, declined, maybe, and total counts
 */
export function calculateRsvpCounts(occurrence: MeetingOccurrence | null, allRsvps: MeetingRsvp[], meetingStartTime?: string): RsvpCounts {
  if (allRsvps.length === 0) {
    return { accepted: 0, declined: 0, maybe: 0, total: 0 };
  }

  // Group RSVPs by username to handle multiple RSVPs from the same user
  const rsvpsByUsername = new Map<string, MeetingRsvp[]>();

  for (const rsvp of allRsvps) {
    const username = rsvp.username;
    if (!rsvpsByUsername.has(username)) {
      rsvpsByUsername.set(username, []);
    }
    rsvpsByUsername.get(username)!.push(rsvp);
  }

  // For each user, determine which RSVP applies to this occurrence
  const applicableRsvps: MeetingRsvp[] = [];

  for (const userRsvps of rsvpsByUsername.values()) {
    const applicableRsvp = getApplicableRsvp(occurrence, userRsvps, meetingStartTime);
    if (applicableRsvp) {
      applicableRsvps.push(applicableRsvp);
    }
  }

  // Count responses
  const counts: RsvpCounts = {
    accepted: 0,
    declined: 0,
    maybe: 0,
    total: applicableRsvps.length,
  };

  for (const rsvp of applicableRsvps) {
    if (rsvp.response === 'accepted') {
      counts.accepted++;
    } else if (rsvp.response === 'declined') {
      counts.declined++;
    } else if (rsvp.response === 'maybe') {
      counts.maybe++;
    }
  }

  return counts;
}

/**
 * Get the applicable RSVP for a user given an occurrence
 * Uses the most recent RSVP that applies to the occurrence
 *
 * @param occurrence - The occurrence to check (or null for non-recurring meetings)
 * @param userRsvps - All RSVPs from a single user for this meeting
 * @param meetingStartTime - The meeting start time (for non-recurring meetings)
 * @returns The most recent applicable RSVP, or null if none apply
 */
function getApplicableRsvp(occurrence: MeetingOccurrence | null, userRsvps: MeetingRsvp[], meetingStartTime?: string): MeetingRsvp | null {
  // Sort RSVPs by updated_at (most recent first)
  const sortedRsvps = [...userRsvps].sort((a, b) => {
    const dateA = new Date(a.updated_at || a.created_at).getTime();
    const dateB = new Date(b.updated_at || b.created_at).getTime();
    return dateB - dateA; // Descending order (newest first)
  });

  // For non-recurring meetings, return the most recent RSVP
  if (!occurrence) {
    return sortedRsvps[0] || null;
  }

  const occurrenceId = occurrence.occurrence_id;
  const occurrenceDate = new Date(occurrence.start_time);

  // Check each RSVP from newest to oldest (most recent wins)
  // Return the first RSVP that applies to this occurrence
  for (const rsvp of sortedRsvps) {
    // Check if this RSVP applies to the current occurrence
    if (rsvp.scope === 'all') {
      // 'all' scope applies to all occurrences
      return rsvp;
    }

    // Check for 'single' scope with matching occurrence_id
    if (rsvp.scope === 'single' && occurrenceId) {
      if (rsvp.occurrence_id === occurrenceId || rsvp.occurrence_id === String(occurrenceId)) {
        return rsvp;
      }
      // If occurrence_id doesn't match, this RSVP doesn't apply to this occurrence
      continue;
    }

    if (rsvp.scope === 'following') {
      // 'following' scope applies to this occurrence and all future ones
      // Check if this RSVP was created before or at the time of this occurrence
      const rsvpDate = new Date(rsvp.created_at);
      if (rsvpDate <= occurrenceDate) {
        return rsvp;
      }
      // If created after this occurrence, it doesn't apply
      continue;
    }
  }

  // No applicable RSVP found
  return null;
}
