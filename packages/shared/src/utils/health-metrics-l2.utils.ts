// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HealthMetricsL2Section, HealthMetricsL2SectionView } from '../interfaces/health-metrics-l2.interface';

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
