// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { FormationItemStatus, MyFormationItemRow } from '../interfaces/formation.interface';
import { buildFormationItemActions, formatMyFormationSubtitle, isAssignedItemOpen, summarizeMyFormationItems } from './formation-me.utils';

const items = (...statuses: FormationItemStatus[]): { status: FormationItemStatus }[] => statuses.map((status) => ({ status }));

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
  version: 1,
  can_write: true,
  ...overrides,
});

describe('isAssignedItemOpen', () => {
  it('excludes done and skipped', () => {
    expect(isAssignedItemOpen('done')).toBe(false);
    expect(isAssignedItemOpen('skipped')).toBe(false);
  });

  it('keeps every other status, including awaiting_acceptance', () => {
    expect(isAssignedItemOpen('not_started')).toBe(true);
    expect(isAssignedItemOpen('in_progress')).toBe(true);
    expect(isAssignedItemOpen('blocked')).toBe(true);
    expect(isAssignedItemOpen('awaiting_acceptance')).toBe(true);
  });
});

describe('summarizeMyFormationItems', () => {
  it('buckets a single not_started item as to-do (GH-1956 N=1)', () => {
    expect(summarizeMyFormationItems(items('not_started'))).toEqual({
      assigned_to_do: 1,
      assigned_with_team: 0,
      assigned_done: 0,
      assigned_skipped: 0,
    });
  });

  it('buckets across three formations worth of items', () => {
    const result = summarizeMyFormationItems(items('not_started', 'in_progress', 'blocked', 'awaiting_acceptance', 'done', 'skipped'));
    expect(result).toEqual({ assigned_to_do: 3, assigned_with_team: 1, assigned_done: 1, assigned_skipped: 1 });
  });

  it('counts a claimed (in_progress) item as to-do, not done and not with the formation team', () => {
    const result = summarizeMyFormationItems(items('in_progress'));
    expect(result).toEqual({ assigned_to_do: 1, assigned_with_team: 0, assigned_done: 0, assigned_skipped: 0 });
  });

  it('returns skipped counted separately from done, not folded together', () => {
    expect(summarizeMyFormationItems(items('done', 'skipped'))).toEqual({
      assigned_to_do: 0,
      assigned_with_team: 0,
      assigned_done: 1,
      assigned_skipped: 1,
    });
  });
});

describe('formatMyFormationSubtitle', () => {
  it('renders all four buckets joined with middle dots', () => {
    expect(formatMyFormationSubtitle({ assigned_to_do: 2, assigned_with_team: 1, assigned_done: 1, assigned_skipped: 1 })).toBe(
      '2 to do · 1 with formation team · 1 done · 1 skipped'
    );
  });

  it('drops zero-count buckets instead of padding with "0 done"', () => {
    expect(formatMyFormationSubtitle({ assigned_to_do: 1, assigned_with_team: 0, assigned_done: 0, assigned_skipped: 0 })).toBe('1 to do');
  });

  it('reads correctly at N=1 for the with-team bucket alone', () => {
    expect(formatMyFormationSubtitle({ assigned_to_do: 0, assigned_with_team: 1, assigned_done: 0, assigned_skipped: 0 })).toBe('1 with formation team');
  });

  it('keeps skipped its own segment rather than folding it into done', () => {
    expect(formatMyFormationSubtitle({ assigned_to_do: 0, assigned_with_team: 0, assigned_done: 0, assigned_skipped: 1 })).toBe('1 skipped');
  });

  it('returns an empty string when every bucket is zero', () => {
    expect(formatMyFormationSubtitle({ assigned_to_do: 0, assigned_with_team: 0, assigned_done: 0, assigned_skipped: 0 })).toBe('');
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

  it('never emits a "Mark done" button text, even for an awaiting_acceptance row (GH-1956 decision 3)', () => {
    const [action] = buildFormationItemActions([formationItemRow({ status: 'awaiting_acceptance' })]);
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
