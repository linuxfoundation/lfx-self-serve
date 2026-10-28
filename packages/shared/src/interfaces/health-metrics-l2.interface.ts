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

/** One anchored section of a Health Metrics Level 2 tab; the key doubles as its URL fragment. */
export interface HealthMetricsL2Section {
  key: string;
  label: string;
  heading: string;
  description: string;
  /** Empty renders no footnote. */
  footnote: readonly HealthMetricsFootnotePart[];
  footnoteCaution: boolean;
  /** A pill beside the heading, e.g. for figures still pending validation. */
  headingBadge?: string;
  /** What the section shows once it settles with nothing for the period. */
  empty: HealthMetricsL2SectionEmpty;
}

/** A section's empty state: its icon, and where its data comes from, finishing "This fills in …". */
export interface HealthMetricsL2SectionEmpty {
  icon: string;
  source: string;
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

/** Sub-nav badge for one section: a count plus an optional qualifier note. */
export interface HealthMetricsL2SubNavItem {
  key: string;
  label: string;
  /** `null` renders no badge — an unresolved total, or a section the design gives none. */
  count: number | null;
  /** e.g. `3 dormant`; empty when nothing qualifies. */
  note: string;
}
