// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HEALTH_METRICS_L2_RANGES } from '../constants/health-metrics-l2.constants';

/** A period the Level 2 views have columns for — `COMPLETED_YEAR_4` is not one of them. */
export type HealthMetricsL2Range = (typeof HEALTH_METRICS_L2_RANGES)[number];

/** One run of footnote text: plain, bold, or a link to another Health Metrics tab. */
export interface HealthMetricsFootnotePart {
  text: string;
  bold?: boolean;
  /** Tab path segment under `HEALTH_METRICS_BASE_PATH`; when set, the run links to that tab. */
  route?: string;
}

/** A Health Metrics note's kind: a caution, or a verdict (healthy, needs attention, needs action, or a plain summary). */
export type HealthMetricsNoteTone = 'caution' | 'healthy' | 'attention' | 'action' | 'summary';

/** A note under a section: a caution or a verdict, with its text in runs. */
export interface HealthMetricsNote {
  tone: HealthMetricsNoteTone;
  parts: readonly HealthMetricsFootnotePart[];
}

/** How a note tone renders: the `lfx-ui-note` variant, and the verdict label before the text (empty for a caution). */
export interface HealthMetricsNoteStyle {
  variant: 'secondary' | 'success' | 'warning' | 'error';
  label: string;
}

/** One anchored section of a Health Metrics Level 2 tab; the key doubles as its URL fragment. */
export interface HealthMetricsL2Section {
  key: string;
  label: string;
  heading: string;
  description: string;
  /** A caution or verdict under the section's body. */
  note?: HealthMetricsNote;
  /** Marks figures still pending validation with a Provisional badge beside the heading. */
  provisional?: boolean;
  /** What the section shows once it settles with nothing for the period. */
  empty: HealthMetricsL2SectionEmpty;
}

/** A section's empty state: its icon, and where its data comes from, finishing "This fills in …". */
export interface HealthMetricsL2SectionEmpty {
  icon: string;
  source: string;
  /** The section shows today's figures whatever the period, so its empty state never names a past year. */
  snapshot?: boolean;
}

/** A section's empty state as shown, worded for YTD or the selected past year. */
export interface HealthMetricsL2EmptyCopy {
  icon: string;
  title: string;
  text: string;
}

/** The single card that replaces a Health Metrics page when it has no data for the period. */
export interface HealthMetricsBlankCopy {
  title: string;
  lead: string;
  reasons: readonly string[];
}

/** One icon tile on a blank card; the Overview curves five of them, a tab shows one. */
export interface HealthMetricsBlankTile {
  icon: string;
  /** The tile's drop and tilt, which lay the Overview's row out as a gentle upward curve. */
  transform: string;
  iconSizePx: number;
}

/**
 * A tab's blank card: its icon, the noun in "No {noun} data yet", the YTD lead and reasons, and the
 * activity a past year's lead names ("No {pastActivity} was recorded…").
 */
export interface HealthMetricsL2Blank {
  icon: string;
  noun: string;
  lead: string;
  reasons: readonly string[];
  pastActivity: string;
}

/** A tab's blank card as shown for the period. */
export interface HealthMetricsL2BlankView {
  tile: HealthMetricsBlankTile;
  copy: HealthMetricsBlankCopy;
}

/** A section with its DOM ids resolved once, so the template never calls a builder per render. */
export interface HealthMetricsL2SectionView extends HealthMetricsL2Section {
  id: string;
  headingId: string;
}

/** Sub-nav entry for one section, with an optional warning note. */
export interface HealthMetricsL2SubNavItem {
  key: string;
  label: string;
  /** e.g. `3 dormant`; empty when nothing qualifies. */
  note: string;
}

/** A row of the shared chart popup: a label on the left, its value on the right. */
export interface HealthMetricsChartTipRowView {
  label: string;
  value: string;
  /** The row's dot; `transparent` keeps its space so the label lines up with the coloured rows, `null` drops it. */
  color: string | null;
  /** A rule above the row. */
  separated: boolean;
  /** "Label: value" on one line with a semibold value, in place of the label and value at either end. */
  inline?: boolean;
}

/** The shared chart popup: a title over label–value rows. */
export interface HealthMetricsChartTipView {
  title: string;
  rows: HealthMetricsChartTipRowView[];
}

/** How a metrics row colours a trend: a rise, a fall, flat or not available, or plain context in place of a change. */
export type HealthMetricsMetricTrendTone = 'up' | 'down' | 'flat' | 'context';

/** A metrics row item's 120 × 4 bar with its caption. */
export interface HealthMetricsMetricBar {
  /** Fill width, 0 to 100. */
  pct: number;
  /** Tailwind background class for the fill, such as `bg-blue-500`. */
  fillClass: string;
  /** Text after the bar, such as `{N} of {M}`. */
  label: string;
}

/** One headline number in the drill-down tabs' shared metrics row. */
export interface HealthMetricsMetricItem {
  key: string;
  label: string;
  value: string;
  /** Signed change under the value, such as `+12%`, or plain context when `trendTone` is `context`. */
  trend?: string;
  trendTone?: HealthMetricsMetricTrendTone;
  /** Tailwind background class for the 8px status dot before the label, such as `bg-emerald-500`. */
  dotClass?: string;
  /** Help text behind the question mark after the label. */
  tip?: string;
  /** Muted line under the value, such as ` vs {Month}`. */
  description?: string;
  /** Coloured lead before the description, such as `+{N}%`. */
  descriptionLead?: string;
  descriptionLeadTone?: 'up' | 'down';
  bar?: HealthMetricsMetricBar;
}
