// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { FormationItem, FormationItemStatus } from '../interfaces/formation.interface';
import { deriveFormationReadinessSummary } from './formation-checklist.utils';

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
