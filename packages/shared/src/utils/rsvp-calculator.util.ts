// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ITXMeetingResponseResult, MeetingOccurrence, MeetingRsvp, RsvpCounts } from '../interfaces/meeting.interface';

/**
 * Calculate RSVP counts for a specific occurrence
 * Takes into account RSVP scope (single, all, this_and_following) and uses the most recent RSVP per user
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

  // Group RSVPs by registrant_id to handle multiple RSVPs from the same user
  const rsvpsByRegistrant = new Map<string, MeetingRsvp[]>();

  for (const rsvp of allRsvps) {
    const key = rsvp.registrant_id;
    if (!rsvpsByRegistrant.has(key)) {
      rsvpsByRegistrant.set(key, []);
    }
    rsvpsByRegistrant.get(key)!.push(rsvp);
  }

  // For each user, determine which RSVP applies to this occurrence
  const applicableRsvps: MeetingRsvp[] = [];

  for (const userRsvps of rsvpsByRegistrant.values()) {
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
    if (rsvp.response_type === 'accepted') {
      counts.accepted++;
    } else if (rsvp.response_type === 'declined') {
      counts.declined++;
    } else if (rsvp.response_type === 'maybe') {
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
  // Sort RSVPs by most recent modification (API sends modified_at, fallback to updated_at then created_at)
  const sortedRsvps = [...userRsvps].sort((a, b) => {
    const dateA = new Date(a.modified_at || a.updated_at || a.created_at).getTime();
    const dateB = new Date(b.modified_at || b.updated_at || b.created_at).getTime();
    return dateB - dateA; // Descending order (newest first)
  });

  // For non-recurring meetings, return the most recent RSVP
  if (!occurrence) {
    return sortedRsvps[0] || null;
  }

  const occurrenceId = occurrence.occurrence_id;
  const occurrenceDate = new Date(occurrence.start_time);
  // Build the expected meeting_and_occurrence_id for this occurrence (e.g., "95156357074_1707321600000")
  const meetingAndOccurrenceId = occurrenceId ? `${sortedRsvps[0]?.meeting_id}_${occurrenceId}` : null;

  // Check each RSVP from newest to oldest (most recent wins)
  // Return the first RSVP that applies to this occurrence
  for (const rsvp of sortedRsvps) {
    // Check if this RSVP applies to the current occurrence
    if (rsvp.scope === 'all') {
      // 'all' scope applies to all occurrences
      return rsvp;
    }

    // Check for 'single' scope — match by occurrence_id or meeting_and_occurrence_id
    if (rsvp.scope === 'single' && occurrenceId) {
      const rsvpOccurrenceId = rsvp.occurrence_id || '';
      const matchesOccurrenceId = rsvpOccurrenceId === occurrenceId || rsvpOccurrenceId === String(occurrenceId);
      const matchesMeetingAndOccurrenceId = meetingAndOccurrenceId && rsvp.meeting_and_occurrence_id === meetingAndOccurrenceId;

      if (matchesOccurrenceId || matchesMeetingAndOccurrenceId) {
        return rsvp;
      }
      // If neither matches, this RSVP doesn't apply to this occurrence
      continue;
    }

    if (rsvp.scope === 'this_and_following') {
      // 'this_and_following' scope applies to this occurrence and all future ones
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

/**
 * Map an ITX meeting response result to the MeetingRsvp shape used throughout the UI
 *
 * @param result - The raw response from the ITX endpoint
 * @returns A MeetingRsvp object compatible with the rest of the application
 */
export function mapITXResponseToMeetingRsvp(result: ITXMeetingResponseResult): MeetingRsvp {
  return {
    id: result.id,
    meeting_id: result.meeting_id,
    registrant_id: result.registrant_id,
    username: result.username,
    email: result.email,
    response_type: result.response,
    scope: result.scope,
    occurrence_id: result.occurrence_id,
    created_at: result.created_at,
    updated_at: result.updated_at,
  };
}
