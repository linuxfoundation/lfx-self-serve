// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { PendingActionItem } from '../interfaces/components.interface';
import type { FormationItemStatus, MyFormationItemRow } from '../interfaces/formation.interface';
import {
  buildFormationItemActions,
  buildFormationPendingActionView,
  formatMyFormationSubtitle,
  isAssignedItemOpen,
  summarizeMyFormationItems,
} from './formation-me.utils';

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
  can_set_status: true,
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
      severity: 'accent',
      buttonText: 'View item',
      formationProjectUid: 'project-1',
      formationProjectSlug: 'acme-project',
      formationItemKey: 'legal-review',
      formationItemUid: 'item-1',
      formationItemStatus: 'not_started',
      formationIsGating: true,
    });
  });

  // #2732: the row's one action navigates to the checklist item; nothing on the row reads the
  // item's own `action_href` or the drawer-only permission flags any more.
  it('carries no buttonLink and none of the retired drawer-only permission fields', () => {
    const [action] = buildFormationItemActions([formationItemRow({ action_href: 'https://example.com/charter', can_write: true, can_set_status: true })]);
    expect(action.buttonLink).toBeUndefined();
    expect(action).not.toHaveProperty('formationCanWrite');
    expect(action).not.toHaveProperty('formationCanSetStatus');
    expect(action).not.toHaveProperty('formationItemAction');
  });

  it('never emits a "Mark done" button text, regardless of the row\'s status (GH-1956 decision 3)', () => {
    const [action] = buildFormationItemActions([formationItemRow({ status: 'blocked' })]);
    expect(action.buttonText).toBe('View item');
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
});

// #2732: the per-row view both Pending Actions surfaces (the dashboard list and its "View all"
// drawer) precompute from a FormationItem row — link, status chip and due label — so neither
// template calls a function and the two can't drift.
describe('buildFormationPendingActionView', () => {
  const formationAction = (overrides: Partial<PendingActionItem> = {}): PendingActionItem => ({
    ...buildFormationItemActions([formationItemRow()])[0],
    ...overrides,
  });

  it('builds the checklist link from the project slug and the template item key', () => {
    const view = buildFormationPendingActionView(formationAction());
    expect(view.isFormationItem).toBe(true);
    expect(view.formationViewCommands).toEqual(['/project/formation']);
    expect(view.formationViewQueryParams).toEqual({ project: 'acme-project', item: 'legal-review' });
  });

  it.each([
    ['not_started', 'Not started', 'secondary'],
    ['in_progress', 'In progress', 'warn'],
    ['blocked', 'Blocked', 'danger'],
  ] as const)('labels the %s status chip "%s" with the %s tone', (status, label, severity) => {
    const view = buildFormationPendingActionView(formationAction({ formationItemStatus: status }));
    expect(view.formationStatusLabel).toBe(label);
    expect(view.formationStatusSeverity).toBe(severity);
  });

  it('formats the due date as a short month-day label and drops it when absent or malformed', () => {
    expect(buildFormationPendingActionView(formationAction({ date: '2026-10-01' })).formationDueLabel).toBe('Oct 1');
    expect(buildFormationPendingActionView(formationAction({ date: undefined })).formationDueLabel).toBeNull();
    expect(buildFormationPendingActionView(formationAction({ date: 'not-a-date' })).formationDueLabel).toBeNull();
  });

  it('is all-null for a non-formation row', () => {
    const rsvp: PendingActionItem = { type: 'RSVP', badge: 'CNCF', text: 'RSVP to TAG Security weekly', icon: '', severity: 'warn', buttonText: 'RSVP' };
    expect(buildFormationPendingActionView(rsvp)).toEqual({
      isFormationItem: false,
      formationViewCommands: null,
      formationViewQueryParams: null,
      formationStatusLabel: null,
      formationStatusSeverity: null,
      formationDueLabel: null,
    });
  });

  it('treats a formation row missing its slug or item key as not linkable', () => {
    expect(buildFormationPendingActionView(formationAction({ formationProjectSlug: undefined })).isFormationItem).toBe(false);
    expect(buildFormationPendingActionView(formationAction({ formationItemKey: undefined })).isFormationItem).toBe(false);
    expect(buildFormationPendingActionView(formationAction({ formationItemKey: undefined })).formationViewCommands).toBeNull();
  });
});
