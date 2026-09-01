// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FORMATION_ORPHAN_SECTION } from '../constants/formation.constants';
import type { FormationItem, FormationItemStatus, FormationTemplateSection } from '../interfaces/formation.interface';
import {
  collectFormationOrphanItems,
  deriveFormationReadinessSummary,
  formatFormationRelativeDayCount,
  groupFormationItemsBySection,
} from './formation-checklist.utils';

let uidCounter = 0;

/** Builds a FormationItem fixture, defaulting every field so tests set only what they assert on. */
function item(partial: Partial<FormationItem> & { status: FormationItemStatus }): FormationItem {
  uidCounter += 1;
  return {
    uid: partial.uid ?? `item-${uidCounter}`,
    formation_uid: partial.formation_uid ?? 'formation-1',
    template_item_key: partial.template_item_key ?? 'key',
    section_key: partial.section_key ?? 'section',
    section_title: partial.section_title ?? 'Section',
    title: partial.title ?? 'Item',
    status: partial.status,
    is_gating: partial.is_gating ?? false,
    owner_team: partial.owner_team ?? null,
    owner: partial.owner ?? null,
    due_date: partial.due_date ?? null,
    action: partial.action ?? 'manual',
    action_href: partial.action_href ?? null,
    detail: partial.detail ?? null,
    notes: partial.notes ?? null,
    links: partial.links ?? [],
    sub_items: partial.sub_items ?? [],
    skip_reason: partial.skip_reason ?? null,
    can_complete: partial.can_complete ?? true,
    created_at: partial.created_at ?? '',
    updated_at: partial.updated_at ?? '',
  };
}

/** Builds a FormationTemplateSection fixture with no items — `groupFormationItemsBySection`/`collectFormationOrphanItems` only read `key`. */
function section(key: string, title = key): FormationTemplateSection {
  return { key, title, items: [] };
}

describe('deriveFormationReadinessSummary', () => {
  it('returns one segment per item, in item order, colored by that item’s own status', () => {
    const items = [item({ status: 'done' }), item({ status: 'in_progress' }), item({ status: 'waiting_on_partner' }), item({ status: 'not_started' })];

    const summary = deriveFormationReadinessSummary(items);

    expect(summary.segments).toEqual(['done', 'in_progress', 'waiting_on_partner', 'not_started']);
    expect(summary.totalItems).toBe(4);
  });

  it('tallies counts per status', () => {
    const items = [item({ status: 'done' }), item({ status: 'done' }), item({ status: 'skipped' }), item({ status: 'not_started' })];

    const summary = deriveFormationReadinessSummary(items);

    expect(summary.counts).toEqual({
      not_started: 1,
      in_progress: 0,
      waiting_on_partner: 0,
      done: 2,
      skipped: 1,
    });
  });

  it('counts only gating items toward openGatingItems/totalGatingItems', () => {
    const items = [
      item({ status: 'done', is_gating: true }),
      item({ status: 'not_started', is_gating: true }),
      item({ status: 'not_started', is_gating: false }),
    ];

    const summary = deriveFormationReadinessSummary(items);

    expect(summary.totalGatingItems).toBe(2);
    expect(summary.openGatingItems).toBe(1);
  });

  it('isActivating is true only when every gating item is done and at least one gating item exists', () => {
    const allDone = deriveFormationReadinessSummary([item({ status: 'done', is_gating: true }), item({ status: 'done', is_gating: true })]);
    expect(allDone.isActivating).toBe(true);

    const oneOpen = deriveFormationReadinessSummary([item({ status: 'done', is_gating: true }), item({ status: 'not_started', is_gating: true })]);
    expect(oneOpen.isActivating).toBe(false);

    const noGatingItems = deriveFormationReadinessSummary([item({ status: 'done', is_gating: false })]);
    expect(noGatingItems.isActivating).toBe(false);
  });

  it('treats a skipped gating item as resolved, not open — skipFormationItem is the designed escape hatch for a gate that cannot be completed', () => {
    const doneAndSkipped = deriveFormationReadinessSummary([item({ status: 'done', is_gating: true }), item({ status: 'skipped', is_gating: true })]);

    expect(doneAndSkipped.openGatingItems).toBe(0);
    expect(doneAndSkipped.isActivating).toBe(true);
  });

  it('ignores a status value outside the known union rather than corrupting counts into NaN', () => {
    const items = [item({ status: 'done' }), item({ status: 'weird_future_status' as FormationItemStatus })];

    const summary = deriveFormationReadinessSummary(items);

    expect(summary.counts.done).toBe(1);
    expect(Number.isNaN(summary.counts.not_started)).toBe(false);
    expect(summary.totalItems).toBe(2);
  });

  it('ignores an inherited Object.prototype key (e.g. "toString") rather than corrupting counts via the prototype chain', () => {
    const items = [item({ status: 'done' }), item({ status: 'toString' as FormationItemStatus })];

    const summary = deriveFormationReadinessSummary(items);

    expect(summary.counts.done).toBe(1);
    expect(typeof summary.counts.toString).toBe('function');
  });

  it('returns zeroed counts and no segments for an empty item list', () => {
    const summary = deriveFormationReadinessSummary([]);

    expect(summary.segments).toEqual([]);
    expect(summary.totalItems).toBe(0);
    expect(summary.isActivating).toBe(false);
    expect(summary.counts).toEqual({
      not_started: 0,
      in_progress: 0,
      waiting_on_partner: 0,
      done: 0,
      skipped: 0,
    });
  });
});

describe('collectFormationOrphanItems', () => {
  it('returns items whose section_key matches no known section', () => {
    const known = item({ status: 'not_started', section_key: 'legal-and-entity' });
    const orphan = item({ status: 'not_started', section_key: 'renamed-section' });

    const orphans = collectFormationOrphanItems([known, orphan], [section('legal-and-entity')]);

    expect(orphans).toEqual([orphan]);
  });

  it('returns an empty array when every item matches a known section', () => {
    const items = [item({ status: 'not_started', section_key: 'legal-and-entity' })];

    expect(collectFormationOrphanItems(items, [section('legal-and-entity')])).toEqual([]);
  });
});

describe('groupFormationItemsBySection', () => {
  it('buckets items under their matching section, in template order', () => {
    const legalItem = item({ status: 'done', section_key: 'legal-and-entity' });
    const launchItem = item({ status: 'not_started', section_key: 'community-and-launch' });

    const rendered = groupFormationItemsBySection(
      [launchItem, legalItem],
      [section('legal-and-entity', 'Legal and entity'), section('community-and-launch', 'Community and launch')]
    );

    expect(rendered.map((entry) => entry.section.key)).toEqual(['legal-and-entity', 'community-and-launch']);
    expect(rendered[0].items).toEqual([legalItem]);
    expect(rendered[1].items).toEqual([launchItem]);
  });

  it('buckets an orphaned item into a synthetic fallback section instead of dropping it', () => {
    const orphan = item({ status: 'not_started', section_key: 'renamed-section' });

    const rendered = groupFormationItemsBySection([orphan], [section('legal-and-entity')]);

    expect(rendered).toHaveLength(2);
    expect(rendered[1].section.key).toBe(FORMATION_ORPHAN_SECTION.key);
    expect(rendered[1].items).toEqual([orphan]);
  });

  it('omits the fallback section entirely when there are no orphaned items', () => {
    const rendered = groupFormationItemsBySection([], [section('legal-and-entity')]);

    expect(rendered).toHaveLength(1);
  });
});

describe('formatFormationRelativeDayCount', () => {
  const NOW = new Date('2026-06-15T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "today" for the current moment', () => {
    expect(formatFormationRelativeDayCount(NOW)).toBe('today');
  });

  it('pluralizes a future day count', () => {
    expect(formatFormationRelativeDayCount(new Date(NOW.getTime() + 3 * 86_400_000))).toBe('3 days');
  });

  it('singularizes exactly 1 day in the future', () => {
    expect(formatFormationRelativeDayCount(new Date(NOW.getTime() + 1 * 86_400_000))).toBe('1 day');
  });

  it('singularizes exactly 1 day in the past', () => {
    expect(formatFormationRelativeDayCount(new Date(NOW.getTime() - 1 * 86_400_000))).toBe('1 day ago');
  });

  it('pluralizes a past day count', () => {
    expect(formatFormationRelativeDayCount(new Date(NOW.getTime() - 3 * 86_400_000))).toBe('3 days ago');
  });

  // Math.round's half-up behavior means the "today" boundary isn't symmetric: -0.5 days rounds to
  // -0 ("today"), +0.5 days rounds to 1 ("1 day"). Documenting the actual boundary rather than
  // changing it — a 12-hour skew either way is well inside "today" for this label's purpose.
  it('rounds a date 12 hours in the past to "today"', () => {
    expect(formatFormationRelativeDayCount(new Date(NOW.getTime() - 12 * 60 * 60 * 1000))).toBe('today');
  });

  it('rounds a date 12 hours in the future to "1 day"', () => {
    expect(formatFormationRelativeDayCount(new Date(NOW.getTime() + 12 * 60 * 60 * 1000))).toBe('1 day');
  });
});
