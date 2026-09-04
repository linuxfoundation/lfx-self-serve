// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FormationItem, FormationItemStatus, FormationTemplateSection } from '../interfaces/formation.interface';
import type { FormationReadinessSummary, FormationRenderedSection } from '../interfaces/formation-checklist.interface';
import { FORMATION_ORPHAN_SECTION } from '../constants/formation.constants';

const EMPTY_COUNTS: Record<FormationItemStatus, number> = {
  not_started: 0,
  in_progress: 0,
  blocked: 0,
  awaiting_acceptance: 0,
  done: 0,
  skipped: 0,
};

/**
 * Client-side stand-in for the readiness strip. TODO(#1957): delete this call site once the
 * backend returns a pre-computed `readiness_summary` — see the doc comment on
 * {@link FormationReadinessSummary}.
 *
 * A gating item counts as resolved once it's `done` OR `skipped` — `skipFormationItem` exists
 * specifically as the escape hatch for a gate the project can't complete, so treating a skipped
 * gate as still-open would make `isActivating` permanently unreachable for any formation that
 * ever uses it.
 */
export function deriveFormationReadinessSummary(items: FormationItem[]): FormationReadinessSummary {
  const counts = { ...EMPTY_COUNTS };
  let openGatingItems = 0;
  let totalGatingItems = 0;

  for (const item of items) {
    // Items cross a wire boundary (see TODO(#1957) on FormationChecklistResponse) — a status value
    // the frontend doesn't know yet must not corrupt the tally into NaN. `in` would also match
    // inherited Object.prototype keys (e.g. a status of "toString"); hasOwnProperty doesn't.
    if (Object.prototype.hasOwnProperty.call(counts, item.status)) {
      counts[item.status] += 1;
    }
    if (item.is_gating) {
      totalGatingItems += 1;
      if (item.status !== 'done' && item.status !== 'skipped') openGatingItems += 1;
    }
  }

  return {
    segments: items.map((item) => item.status),
    totalItems: items.length,
    counts,
    isActivating: totalGatingItems > 0 && openGatingItems === 0,
    openGatingItems,
    totalGatingItems,
  };
}

/**
 * Items whose `section_key` matches none of the template's current sections — exactly what a
 * template section rename produces for items still carrying the old key. Shared between
 * `groupFormationItemsBySection` (bucketing) and the caller that logs a template/item drift, so
 * the two can't fall out of sync on what counts as "orphaned."
 */
export function collectFormationOrphanItems(items: FormationItem[], sections: FormationTemplateSection[]): FormationItem[] {
  const knownKeys = new Set<string>(sections.map((section) => section.key));
  return items.filter((item) => !knownKeys.has(item.section_key));
}

/**
 * Buckets checklist items under their template section, in template order. Driven by `sections`,
 * not a hardcoded key list — a template revision (#1957/#1959) that adds or renames a section
 * still renders instead of silently dropping items; any orphaned item (see
 * `collectFormationOrphanItems`) is bucketed into a synthetic `FORMATION_ORPHAN_SECTION` fallback
 * rather than dropped.
 */
export function groupFormationItemsBySection(items: FormationItem[], sections: FormationTemplateSection[]): FormationRenderedSection[] {
  const rendered: FormationRenderedSection[] = sections.map((section) => ({
    section,
    items: items.filter((item) => item.section_key === section.key),
  }));

  const orphans = collectFormationOrphanItems(items, sections);
  if (orphans.length > 0) {
    // FORMATION_ORPHAN_SECTION's key ('__orphan__') is deliberately outside FormationTemplateSectionKey —
    // it's a synthetic fallback bucket, never a real template section.
    rendered.push({ section: { ...FORMATION_ORPHAN_SECTION, items: [] } as unknown as FormationTemplateSection, items: orphans });
  }

  return rendered;
}

/** `FormationReadinessStripComponent`'s "N days" / "N days ago" / "today" label for an announcement date, relative to now. */
export function formatFormationRelativeDayCount(date: Date): string {
  const diffDays = Math.round((date.getTime() - Date.now()) / 86_400_000);
  if (diffDays === 0) return 'today';
  if (diffDays > 0) return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
  const past = Math.abs(diffDays);
  return `${past} day${past === 1 ? '' : 's'} ago`;
}
