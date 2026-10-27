// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgEventAttendeeDetailRow, OrgLensTimeRange } from '@lfx-one/shared/interfaces';
import { orgLensTimeRangeStartDate, orgLensUtcToday } from '@lfx-one/shared/utils';

/**
 * The registrations a range counts: events that have ended (end date before today, UTC) and, for a bounded range, ended
 * on or after its first day. A registration for an upcoming or running event counts in no range; one without an end
 * date cannot be placed and counts nowhere either (the warehouse's `IS_PAST_EVENT` is false for it too).
 */
export function filterEndedEventsInRange(details: OrgEventAttendeeDetailRow[], range: OrgLensTimeRange, now: Date = new Date()): OrgEventAttendeeDetailRow[] {
  const today = orgLensUtcToday(now);
  const start = orgLensTimeRangeStartDate(range, now);
  return details.filter((row) => !!row.eventEndDate && row.eventEndDate < today && (start === null || row.eventEndDate >= start));
}
