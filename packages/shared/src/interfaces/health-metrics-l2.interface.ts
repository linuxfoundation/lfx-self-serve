// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** One anchored section of a Health Metrics Level 2 tab; the key doubles as its URL fragment. */
export interface HealthMetricsL2Section {
  key: string;
  label: string;
  heading: string;
  description: string;
  footnote: string;
  footnoteCaution: boolean;
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
