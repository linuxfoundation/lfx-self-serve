// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_L2_BLANK_PAST, HEALTH_METRICS_L2_EMPTY_COPY } from '../constants/health-metrics-l2.constants';

import type {
  HealthMetricsL2Blank,
  HealthMetricsL2BlankView,
  HealthMetricsL2EmptyCopy,
  HealthMetricsL2Section,
  HealthMetricsL2SectionEmpty,
  HealthMetricsL2SectionView,
} from '../interfaces/health-metrics-l2.interface';

/** DOM id for a section; the URL fragment stays the bare key. */
export function buildHealthMetricsL2SectionId(idPrefix: string, key: string): string {
  return `${idPrefix}${key}`;
}

/** Resolves each section's anchor and heading ids once, for a tab's `idPrefix`. */
export function buildHealthMetricsL2SectionViews(sections: readonly HealthMetricsL2Section[], idPrefix: string): HealthMetricsL2SectionView[] {
  return sections.map((section) => {
    const id = buildHealthMetricsL2SectionId(idPrefix, section.key);
    return { ...section, id, headingId: `${id}-heading` };
  });
}

/** True when `fragment` names one of `sections` — the deep-link allowlist. */
export function isHealthMetricsL2SectionKey(sections: readonly HealthMetricsL2Section[], fragment: string | null | undefined): fragment is string {
  return sections.some((section) => section.key === fragment);
}

/** A section's empty state for the period: "Nothing recorded yet" with where it fills in from, or "Nothing in {Y}". */
export function buildHealthMetricsL2EmptyCopy(empty: HealthMetricsL2SectionEmpty, pastYear: number | null): HealthMetricsL2EmptyCopy {
  if (pastYear === null || empty.snapshot) {
    return { icon: empty.icon, title: HEALTH_METRICS_L2_EMPTY_COPY.ytd.title, text: HEALTH_METRICS_L2_EMPTY_COPY.ytd.text.replace('{source}', empty.source) };
  }
  return { icon: empty.icon, title: HEALTH_METRICS_L2_EMPTY_COPY.past.title.replace('{Y}', String(pastYear)), text: HEALTH_METRICS_L2_EMPTY_COPY.past.text };
}

/** A tab's blank card for the period: its one icon tile, "No {noun} data yet" or "… for {Y}", the lead and reasons. */
export function buildHealthMetricsL2BlankView(blank: HealthMetricsL2Blank, pastYear: number | null): HealthMetricsL2BlankView {
  const tile = { icon: blank.icon, transform: 'none', iconSizePx: 24 };
  if (pastYear === null) {
    return { tile, copy: { title: `No ${blank.noun} data yet`, lead: blank.lead, reasons: blank.reasons } };
  }
  const lead = HEALTH_METRICS_L2_BLANK_PAST.lead.replace('{activity}', blank.pastActivity).replace('{Y}', String(pastYear));
  return { tile, copy: { title: `No ${blank.noun} data for ${pastYear}`, lead, reasons: HEALTH_METRICS_L2_BLANK_PAST.reasons } };
}
