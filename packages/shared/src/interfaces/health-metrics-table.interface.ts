// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** A sortable Health Metrics column's state: unsorted, ascending or descending. */
export type HealthMetricsColumnSort = 'none' | 'asc' | 'desc';

/** A 28px icon tile before a cell's text, which indents 38px. */
export interface HealthMetricsCellIconLead {
  kind: 'icon';
  /** Font Awesome classes, e.g. `fa-light fa-ticket`. */
  icon: string;
}

/** A 32px person avatar before a cell's text, which indents 42px. */
export interface HealthMetricsCellPersonLead {
  kind: 'person';
  name: string;
  /** Photo URL; empty falls back to initials. */
  photoUrl: string;
}

/** A 24px company logo box inline before a cell's text; its description indents 32px to line up with the name. */
export interface HealthMetricsCellCompanyLead {
  kind: 'company';
  name: string;
  /** Logo URL; empty falls back to the first letter. */
  logoUrl: string;
}

/** What leads a Health Metrics table cell's text, if anything. */
export type HealthMetricsCellLead = HealthMetricsCellIconLead | HealthMetricsCellPersonLead | HealthMetricsCellCompanyLead;

/** A bar fill that applies below a percentage; the first threshold the value is under wins. */
export interface HealthMetricsBarThreshold {
  /** Exclusive upper bound, 0–100. */
  below: number;
  fillClass: string;
}

/** A value-and-bar cell's fill rule: thresholds over the default fill, and the fill for 0%. */
export interface HealthMetricsBarFillRule {
  zeroClass: string;
  thresholds: readonly HealthMetricsBarThreshold[];
  defaultClass: string;
}
