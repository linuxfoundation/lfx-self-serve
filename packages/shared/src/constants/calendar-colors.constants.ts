// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CalendarColor, CalendarColorPair } from '../interfaces/calendar.interface';
import type { GroupBehavioralClass } from '../interfaces/committee.interface';

import { lfxColors } from './colors.constants';

/** Hex color config per meeting type for FullCalendar events (Tailwind classes don't apply inside FullCalendar). */
export const MEETING_TYPE_COLORS: Record<string, CalendarColorPair> = {
  technical: { bg: lfxColors.violet[600], border: lfxColors.violet[700] },
  maintainers: { bg: lfxColors.blue[600], border: lfxColors.blue[700] },
  board: { bg: lfxColors.red[600], border: lfxColors.red[700] },
  marketing: { bg: lfxColors.emerald[600], border: lfxColors.emerald[700] },
  legal: { bg: lfxColors.amber[600], border: lfxColors.amber[700] },
  other: { bg: lfxColors.gray[600], border: lfxColors.gray[700] },
  default: { bg: lfxColors.blue[500], border: lfxColors.blue[600] },
};

/**
 * Calendar color per group behavioral class, used to tint public project calendar events by committee.
 * Hues track `BEHAVIORAL_CLASS_CONFIG` so the public calendar and the public group directory read as the
 * same taxonomy. `ambassador-program` is the one divergence: the directory uses rose, which `lfxColors`
 * does not carry, so red stands in as the nearest available hue.
 */
export const BEHAVIORAL_CLASS_CALENDAR_COLORS: Record<GroupBehavioralClass, CalendarColor> = {
  'governing-board': { bg: lfxColors.violet[600], border: lfxColors.violet[700], text: lfxColors.white },
  'oversight-committee': { bg: lfxColors.emerald[600], border: lfxColors.emerald[700], text: lfxColors.white },
  'working-group': { bg: lfxColors.amber[600], border: lfxColors.amber[700], text: lfxColors.white },
  'special-interest-group': { bg: lfxColors.blue[600], border: lfxColors.blue[700], text: lfxColors.white },
  'ambassador-program': { bg: lfxColors.red[600], border: lfxColors.red[700], text: lfxColors.white },
  other: { bg: lfxColors.gray[600], border: lfxColors.gray[700], text: lfxColors.white },
};

/** Calendar color for cancelled meeting occurrences. */
export const CANCELLED_COLOR: CalendarColor = {
  bg: lfxColors.gray[400],
  border: lfxColors.gray[500],
  text: lfxColors.white,
};

/** Calendar color for past (ended) meeting occurrences — light fill with dark text for WCAG contrast. */
export const PAST_MEETING_CALENDAR_COLOR: CalendarColor = {
  bg: lfxColors.blue[100],
  border: lfxColors.blue[400],
  text: lfxColors.blue[700],
};

/** Calendar color for vote deadline events. */
export const VOTE_COLOR: CalendarColor = {
  bg: lfxColors.amber[500],
  border: lfxColors.amber[600],
  text: lfxColors.white,
};

/** Calendar color for past vote deadline events — light fill with dark text for WCAG contrast. */
export const PAST_VOTE_CALENDAR_COLOR: CalendarColor = {
  bg: lfxColors.amber[100],
  border: lfxColors.amber[400],
  text: lfxColors.amber[700],
};

/** Calendar color for survey cutoff events. */
export const SURVEY_COLOR: CalendarColor = {
  bg: lfxColors.violet[500],
  border: lfxColors.violet[600],
  text: lfxColors.white,
};

/** Calendar color for past survey cutoff events — light fill with dark text for WCAG contrast. */
export const PAST_SURVEY_CALENDAR_COLOR: CalendarColor = {
  bg: lfxColors.violet[100],
  border: lfxColors.violet[400],
  text: lfxColors.violet[700],
};
