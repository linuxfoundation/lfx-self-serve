// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingRegistrant, MeetingRsvp } from '@lfx-one/shared/interfaces';
import { selectApplicableRsvp } from '@lfx-one/shared/utils';

/**
 * Filters RSVPs down to those belonging to a currently-active registrant.
 *
 * `v1_meeting_rsvp` records persist historical RSVPs including for registrants who have since
 * been removed or re-registered with a new `registrant_id`. Extracted as a pure function (no
 * `MeetingService` dependency, unlike `meeting.helper.ts`, to avoid a service↔helper import
 * cycle) so `MeetingService.getMeetingRsvps` and `MeetingService.getMeetingRegistrants` (when
 * fetching with `includeRsvp`) can share it against whichever registrant roster each has already
 * fetched, instead of each walking the registrant roster a second time just to build this same
 * active-id set (LFXV2-2078).
 *
 * @param rsvps - Raw RSVPs, unfiltered
 * @param registrants - The currently-active registrant roster to filter against
 */
export function filterRsvpsToActiveRegistrants(rsvps: MeetingRsvp[], registrants: MeetingRegistrant[]): MeetingRsvp[] {
  const activeRegistrantIds = new Set(registrants.map((r) => r.uid).filter(Boolean));
  return rsvps.filter((rsvp) => activeRegistrantIds.has(rsvp.registrant_id));
}

/**
 * Attaches each registrant's applicable RSVP (if any) as a `rsvp` field, scoped to `occurrenceId`
 * when provided. Pure function — groups `rsvps` by `registrant_id`, then delegates the
 * per-occurrence selection to the shared {@link selectApplicableRsvp} resolver, keeping this
 * endpoint aligned with the detail-page BFF (`getMeetingRsvpForCurrentUser`) and the counts
 * calculator (`calculateRsvpCounts`) — a newer `single` decline must not shadow an older `all`
 * accept on an unrelated occurrence (LFXV2-2864).
 *
 * @param registrants - Registrants to enrich (not mutated; new objects returned)
 * @param rsvps - RSVPs already filtered to active registrants (see {@link filterRsvpsToActiveRegistrants})
 * @param occurrenceId - Optional occurrence id (seconds or ms) to resolve each registrant's RSVP against
 */
export function attachRsvpsToRegistrants<T extends MeetingRegistrant>(
  registrants: T[],
  rsvps: MeetingRsvp[],
  occurrenceId?: string
): (T & { rsvp: MeetingRsvp | null })[] {
  const rsvpsByRegistrant = new Map<string, MeetingRsvp[]>();
  for (const rsvp of rsvps) {
    const key = rsvp.registrant_id;
    if (!rsvpsByRegistrant.has(key)) {
      rsvpsByRegistrant.set(key, []);
    }
    rsvpsByRegistrant.get(key)!.push(rsvp);
  }

  return registrants.map((registrant) => {
    const registrantRsvps = rsvpsByRegistrant.get(registrant.uid);
    if (!registrantRsvps || registrantRsvps.length === 0) {
      return { ...registrant, rsvp: null };
    }
    return { ...registrant, rsvp: selectApplicableRsvp(occurrenceId, registrantRsvps) };
  });
}
