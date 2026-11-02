// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgEventAttendeeDetailRow, OrgLensTimeRange } from '@lfx-one/shared/interfaces';
import { orgLensTimeRangeStartDate, orgLensUtcToday } from '@lfx-one/shared/utils';

/** An event's date as the warehouse's `COALESCE(event_end_date, event_start_date)` dates it: its end, or its start when it has none. */
export function eventDateOf(row: OrgEventAttendeeDetailRow): string | null {
  return row.eventEndDate ?? row.eventStartDate;
}

/**
 * The registrations a range counts: events that have ended (before today, UTC) and, for a bounded range, ended on or
 * after its first day. An event is dated by its end date, or its start date when it has none, as the warehouse's
 * `COALESCE(event_end_date, event_start_date)` does. A registration for an upcoming or running event counts in no range;
 * one with neither date cannot be placed and counts nowhere.
 */
export function filterEndedEventsInRange(details: OrgEventAttendeeDetailRow[], range: OrgLensTimeRange, now: Date = new Date()): OrgEventAttendeeDetailRow[] {
  const today = orgLensUtcToday(now);
  const start = orgLensTimeRangeStartDate(range, now);
  return details.filter((row) => {
    const eventDate = eventDateOf(row);
    return !!eventDate && eventDate < today && (start === null || eventDate >= start);
  });
}
