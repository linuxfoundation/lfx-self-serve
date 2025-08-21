// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EventInput } from '@fullcalendar/core';

/**
 * Calendar event interface extending FullCalendar's EventInput
 * @description Meeting events displayed in calendar components with LFX-specific properties
 */
export interface CalendarEvent extends EventInput {
  /** Unique event identifier */
  id: string;
  /** Event title displayed on calendar */
  title: string;
  /** Event start date/time (ISO string) */
  start: string;
  /** Event end date/time (ISO string, optional for all-day events) */
  end?: string;
  /** Background color for the event on calendar */
  backgroundColor?: string;
  /** Border color for the event on calendar */
  borderColor?: string;
  /** Text color for the event title */
  textColor?: string;
  /** Extended properties specific to LFX meetings */
  extendedProps?: {
    /** Associated meeting ID */
    meetingId: string;
    /** Meeting visibility level (public/private) */
    visibility: string;
    /** Associated committee name */
    committee?: string;
    /** Additional custom properties */
    [key: string]: any;
  };
}
