// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HEALTH_METRICS_L2_RANGES } from '../constants/health-metrics-l2.constants';

/** A period the Level 2 views have columns for — `COMPLETED_YEAR_4` is not one of them. */
export type HealthMetricsL2Range = (typeof HEALTH_METRICS_L2_RANGES)[number];

/** One anchored section of a Health Metrics Level 2 tab; the key doubles as its URL fragment. */
export interface HealthMetricsL2Section {
  key: string;
  label: string;
  heading: string;
  description: string;
  footnote: string;
  footnoteCaution: boolean;
  /** A pill beside the heading, e.g. for figures still pending validation. */
  headingBadge?: string;
}

/** A section with its DOM ids resolved once, so the template never calls a builder per render. */
export interface HealthMetricsL2SectionView extends HealthMetricsL2Section {
  id: string;
  headingId: string;
}

/** Note under the sub-nav whose trailing tab name links to a section of that tab. */
export interface HealthMetricsL2CrossReference {
  text: string;
  linkLabel: string;
  /** Tab path segment under `HEALTH_METRICS_BASE_PATH`. */
  route: string;
  /** Section key on the target tab, so the link lands on it. */
  fragment: string;
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
