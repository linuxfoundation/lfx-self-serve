// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_PROJECT_SLUG_PATTERN } from '../constants/health-metrics-l2.constants';
import { avatarColorClass } from './avatar.utils';

import type { FoundationProjectsDetailGroup } from '../interfaces/analytics-data.interface';
import type { HealthMetricsL2Section, HealthMetricsL2SectionView, HealthMetricsProjectOption } from '../interfaces/health-metrics-l2.interface';

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

/** The selector's project list: every group's projects, one entry per slug, sorted by name. */
export function buildHealthMetricsProjectOptions(groups: readonly FoundationProjectsDetailGroup[]): HealthMetricsProjectOption[] {
  const bySlug = new Map<string, HealthMetricsProjectOption>();
  for (const project of groups.flatMap((group) => group.projects)) {
    const slug = project.projectSlug?.trim() ?? '';
    if (!HEALTH_METRICS_PROJECT_SLUG_PATTERN.test(slug) || bySlug.has(slug)) {
      continue;
    }
    const name = project.projectName?.trim() || slug;
    bySlug.set(slug, { slug, name, initials: buildHealthMetricsProjectInitials(name), colorClass: avatarColorClass(slug) });
  }
  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
}

/** First letters of the first two words, else the first two alphanumerics. */
export function buildHealthMetricsProjectInitials(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const initials = words.length > 1 ? `${words[0].charAt(0)}${words[1].charAt(0)}` : (words[0] ?? '').slice(0, 2);
  return initials.toUpperCase();
}

/** A `?project=` value worth reading with, or `null` (all projects) for a missing or malformed one. */
export function parseHealthMetricsProjectSlug(value: string | null | undefined): string | null {
  return value && HEALTH_METRICS_PROJECT_SLUG_PATTERN.test(value) ? value : null;
}
