// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { FormationItemStatus, MyFormationItemRow } from '../interfaces/formation.interface';
import { buildFormationItemActions, formatMyFormationSubtitle, isAssignedItemOpen, summarizeMyFormationItems } from './formation-me.utils';

const formationItemRow = (overrides: Partial<MyFormationItemRow> = {}): MyFormationItemRow => ({
  item_uid: 'item-1',
  template_item_key: 'legal-review',
  project_uid: 'project-1',
  project_slug: 'acme-project',
  project_name: 'Acme Project',
  title: 'Complete legal review',
  status: 'not_started',
  is_gating: true,
  due_date: null,
  action: 'manual',
  action_href: null,
  can_write: true,
  ...overrides,
});

describe('isAssignedItemOpen', () => {
  it('excludes done and skipped', () => {
    expect(isAssignedItemOpen('done')).toBe(false);
    expect(isAssignedItemOpen('skipped')).toBe(false);
  });

  it('keeps every other status', () => {
    expect(isAssignedItemOpen('not_started')).toBe(true);
    expect(isAssignedItemOpen('in_progress')).toBe(true);
    expect(isAssignedItemOpen('blocked')).toBe(true);
  });
});

describe('summarizeMyFormationItems', () => {
  const item = (status: FormationItemStatus) => ({ status });

  it('buckets every status into its subtitle count', () => {
    expect(summarizeMyFormationItems([item('not_started'), item('in_progress'), item('blocked'), item('done'), item('skipped')])).toEqual({
      assigned_to_do: 3,
      assigned_done: 1,
      assigned_skipped: 1,
    });
  });

  it('returns all-zero buckets for an empty array', () => {
    expect(summarizeMyFormationItems([])).toEqual({ assigned_to_do: 0, assigned_done: 0, assigned_skipped: 0 });
  });
});

describe('formatMyFormationSubtitle', () => {
  it('renders all three buckets joined with middle dots', () => {
    expect(formatMyFormationSubtitle({ assigned_to_do: 2, assigned_done: 1, assigned_skipped: 1 })).toBe('2 to do · 1 done · 1 skipped');
  });

  it('drops zero-count buckets instead of padding with "0 done"', () => {
    expect(formatMyFormationSubtitle({ assigned_to_do: 1, assigned_done: 0, assigned_skipped: 0 })).toBe('1 to do');
  });

  it('keeps skipped its own segment rather than folding it into done', () => {
    expect(formatMyFormationSubtitle({ assigned_to_do: 0, assigned_done: 0, assigned_skipped: 1 })).toBe('1 skipped');
  });

  it('returns an empty string when every bucket is zero', () => {
    expect(formatMyFormationSubtitle({ assigned_to_do: 0, assigned_done: 0, assigned_skipped: 0 })).toBe('');
  });
});

describe('buildFormationItemActions', () => {
  it('maps a single item to a FormationItem row with the formation-specific fields', () => {
    const [action] = buildFormationItemActions([formationItemRow()]);
    expect(action).toMatchObject({
      type: 'FormationItem',
      badge: 'Acme Project',
      text: 'Complete legal review',
      buttonText: 'Claim',
      formationProjectUid: 'project-1',
      formationItemKey: 'legal-review',
      formationItemUid: 'item-1',
      formationItemStatus: 'not_started',
      formationIsGating: true,
    });
  });

  it('never emits a "Mark done" button text, regardless of the row\'s status (GH-1956 decision 3)', () => {
    const [action] = buildFormationItemActions([formationItemRow({ status: 'blocked' })]);
    expect(action.buttonText).toBe('Claim');
    expect(action.buttonText.toLowerCase()).not.toContain('done');
  });

  it('omits date when due_date is null and sets it when present', () => {
    const [withoutDate] = buildFormationItemActions([formationItemRow({ due_date: null })]);
    expect(withoutDate.date).toBeUndefined();

    const [withDate] = buildFormationItemActions([formationItemRow({ due_date: '2026-10-01' })]);
    expect(withDate.date).toBe('2026-10-01');
  });

  it('preserves row order and count across multiple items', () => {
    const rows = [formationItemRow({ item_uid: 'item-1' }), formationItemRow({ item_uid: 'item-2' }), formationItemRow({ item_uid: 'item-3' })];
    const actions = buildFormationItemActions(rows);
    expect(actions.map((a) => a.formationItemUid)).toEqual(['item-1', 'item-2', 'item-3']);
  });

  it('returns an empty array for no items', () => {
    expect(buildFormationItemActions([])).toEqual([]);
  });

  it('threads can_write through as formationCanWrite unchanged', () => {
    const [writable] = buildFormationItemActions([formationItemRow({ can_write: true })]);
    expect(writable.formationCanWrite).toBe(true);

    const [readOnly] = buildFormationItemActions([formationItemRow({ can_write: false })]);
    expect(readOnly.formationCanWrite).toBe(false);
  });
});
