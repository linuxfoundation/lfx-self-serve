// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FormationItem, FormationItemStatus, FormationTemplateSection } from '../interfaces/formation.interface';
import type { FormationReadinessSummary, FormationRenderedSection } from '../interfaces/formation-checklist.interface';
import { FORMATION_ORPHAN_SECTION } from '../constants/formation.constants';
import { parseIsoDateAsUtcMidnight } from './date-time.utils';

const EMPTY_COUNTS: Record<FormationItemStatus, number> = {
  not_started: 0,
  in_progress: 0,
  blocked: 0,
  awaiting_acceptance: 0,
  done: 0,
  skipped: 0,
};

/**
 * The readiness strip's per-item segment bar and status tally. `isActivating`/`openGatingItems`/
 * `totalGatingItems` are not derived here — the server computes those (see
 * {@link Formation.is_activating}/`gating_items_open`/`gating_items_total`) and callers read them
 * directly off the formation instead of re-deriving a second, possibly-divergent formula.
 */
export function deriveFormationReadinessSummary(items: FormationItem[]): FormationReadinessSummary {
  const counts = { ...EMPTY_COUNTS };

  for (const item of items) {
    // A status value the frontend doesn't know yet must not corrupt the tally into NaN. `in`
    // would also match inherited Object.prototype keys (e.g. a status of "toString");
    // hasOwnProperty doesn't.
    if (Object.prototype.hasOwnProperty.call(counts, item.status)) {
      counts[item.status] += 1;
    }
  }

  return {
    segments: items.map((item) => item.status),
    totalItems: items.length,
    counts,
  };
}

/**
 * The readiness strip's "blocked on…" title(s) — every gating item actually in `blocked` status,
 * joined for display, or `null` when none are blocked. Deliberately not "first not-done gating
 * item": `awaiting_acceptance`/`in_progress`/`not_started` items are open but not blocking, only
 * `blocked` is. Used by `formation-mapper.helper.ts`'s `mapUpstreamFormationChecklist`.
 */
export function deriveFormationBlockingItemTitle(items: FormationItem[]): string | null {
  const blockedGatingItems = items.filter((item) => item.is_gating && item.status === 'blocked');
  return blockedGatingItems.length > 0 ? blockedGatingItems.map((item) => item.title).join(', ') : null;
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

/**
 * `FormationReadinessStripComponent`'s "N days" / "N days ago" / "today" label for an announcement
 * date, relative to now.
 *
 * Diffs UTC calendar-day components on both sides, not raw elapsed milliseconds against
 * `Date.now()` — a whole-day gap between two calendar dates would otherwise drift by one as the
 * current instant ticks past the halfway point of "today" (e.g. a date exactly 170 calendar days
 * ago reads "171 days ago" once more than 12 hours of today have elapsed). Calendar-day diffing
 * anchors both `date` and "now" to UTC midnight first, so the result only ever changes at a day
 * boundary, never within a day.
 */
export function formatFormationRelativeDayCount(date: Date): string {
  const dateUtcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const now = new Date();
  const todayUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffDays = Math.round((dateUtcMidnight - todayUtcMidnight) / 86_400_000);
  if (diffDays === 0) return 'today';
  if (diffDays > 0) return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
  const past = Math.abs(diffDays);
  return `${past} day${past === 1 ? '' : 's'} ago`;
}

/**
 * `FormationReadinessStripComponent`'s "Sun, Mar 23 · 170 days ago" announcement label for a
 * date-only announcement date, or `null` when there is none / it doesn't parse.
 *
 * Parses through `parseIsoDateAsUtcMidnight` — the same UTC-anchored parse `formatIsoDateLabel`
 * uses for the dashboard subtitle and sidebar card — and derives the day count from that same
 * parsed instant, so the calendar day shown here can never disagree with the dashboard's, and the
 * count next to it can never disagree with the date it's counting from.
 */
export function formatFormationAnnouncementLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = parseIsoDateAsUtcMidnight(iso);
  if (!parsed) return null;
  const dateLabel = parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${dateLabel} · ${formatFormationRelativeDayCount(parsed)}`;
}
