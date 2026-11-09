// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgEventAttendeeDetailRow } from '@lfx-one/shared/interfaces';

/** An event's date as the warehouse's `COALESCE(event_end_date, event_start_date)` dates it: its end, or its start when it has none. */
export function eventDateOf(row: OrgEventAttendeeDetailRow): string | null {
  return row.eventEndDate ?? row.eventStartDate;
}
