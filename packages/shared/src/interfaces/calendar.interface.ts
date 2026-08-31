// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EventInput } from '@fullcalendar/core';

import type { GroupBehavioralClass } from './committee.interface';

/** FullCalendar hex colors for event background and border. */
export interface CalendarColorPair {
  bg: string;
  border: string;
}

/** FullCalendar hex colors including readable title/time text. */
export interface CalendarColor extends CalendarColorPair {
  text: string;
}

/** Extended props set on committee calendar events for click routing. */
export interface MeetingCalendarClickProps {
  type: string;
  meetingId?: string;
  cancelled?: boolean;
  password?: string;
  startTime?: string;
  durationMinutes?: number;
  pastMeetingResourceId?: string;
  voteId?: string;
  surveyId?: string;
}

/** A publicly listed group, resolved from the public group directory and keyed by committee UID. */
export interface PublicCalendarCommittee {
  uid: string;
  /** Display name from the public group directory — safe to render, unlike the raw meeting association. */
  name: string;
  /** Behavioral class driving the event color; shared with the public group directory's taxonomy. */
  behavioralClass: GroupBehavioralClass;
}

/** One swatch in a calendar color legend — the text counterpart to color-coded events. */
export interface CalendarLegendItem {
  label: string;
  /** Hex fill matching the events it describes. */
  color: string;
}

/** Committee context passed to `publicMeetingToCalendarEvents` for labelling and color-coding. */
export interface PublicCalendarCommitteeContext {
  /**
   * Committee UID currently selected via `?committee=`. Disambiguates meetings tied to several
   * committees, and suppresses the per-event label that every event would otherwise repeat.
   */
  activeCommitteeUid?: string;
  /** Publicly listed committees by UID. Meetings whose committees are absent fall back to default styling. */
  committeesByUid?: Record<string, PublicCalendarCommittee>;
}

/**
 * Structural FullCalendar event payload for committee calendar rows.
 * Uses a plain interface so shared utils do not bind to a duplicate @fullcalendar/core copy.
 */
export interface MeetingCalendarEventInput {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  display?: string;
  classNames?: string[];
  extendedProps?: MeetingCalendarClickProps;
}

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
