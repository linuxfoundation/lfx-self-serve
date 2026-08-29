// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CalendarColor, CalendarColorPair, CalendarLegendItem } from '../interfaces/calendar.interface';
import type { GroupBehavioralClass } from '../interfaces/committee.interface';

import { lfxColors } from './colors.constants';
import { BEHAVIORAL_CLASS_CONFIG } from './committees.constants';

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

/**
 * Every color the public project calendar can paint an event, in render order: the six behavioral
 * classes, then the fallbacks for an event with no publicly listed group, and the state treatments that
 * override the group tint entirely.
 *
 * Exhaustive by design — `resolvePublicCalendarLegend` filters it down to the colors a given set of
 * events actually uses, so a missing entry here silently drops a swatch from the rendered legend.
 * Class labels are read from `BEHAVIORAL_CLASS_CONFIG` so the calendar and the public group directory
 * cannot disagree on what a group type is called. The `bg` values must stay pairwise distinct, since
 * that filtering matches on color.
 */
export const PUBLIC_CALENDAR_LEGEND: CalendarLegendItem[] = [
  ...(Object.keys(BEHAVIORAL_CLASS_CALENDAR_COLORS) as GroupBehavioralClass[]).map((behavioralClass) => ({
    label: BEHAVIORAL_CLASS_CONFIG[behavioralClass].label,
    color: BEHAVIORAL_CLASS_CALENDAR_COLORS[behavioralClass].bg,
  })),
  { label: 'No group', color: MEETING_TYPE_COLORS['default'].bg },
  { label: 'Past', color: PAST_MEETING_CALENDAR_COLOR.bg },
  { label: 'Cancelled', color: CANCELLED_COLOR.bg },
];
