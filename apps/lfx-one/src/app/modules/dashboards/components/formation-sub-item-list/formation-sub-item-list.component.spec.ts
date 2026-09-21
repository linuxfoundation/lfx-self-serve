// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FORMATION_ITEM_SEGMENT_COLORS, FORMATION_ITEM_STATUS_GLYPHS, FORMATION_ITEM_STATUS_LABELS } from '@lfx-one/shared/constants';
import { FormationItemStatus, FormationSubItem } from '@lfx-one/shared/interfaces';
import { afterEach, describe, expect, it } from 'vitest';

import { FormationSubItemListComponent } from './formation-sub-item-list.component';

const STATUSES: FormationItemStatus[] = ['done', 'in_progress', 'blocked', 'skipped', 'not_started'];

function subItem(status: FormationItemStatus, index: number): FormationSubItem {
  return { uid: `sub_${index}`, title: `Sub-item ${index}`, status };
}

describe('FormationSubItemListComponent', () => {
  let fixture: ComponentFixture<FormationSubItemListComponent>;

  const render = async (subItems: FormationSubItem[], showSummary?: boolean): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ imports: [FormationSubItemListComponent] }).compileComponents();

    fixture = TestBed.createComponent(FormationSubItemListComponent);
    fixture.componentRef.setInput('subItems', subItems);
    if (showSummary !== undefined) {
      fixture.componentRef.setInput('showSummary', showSummary);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const byTestId = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  afterEach(() => {
    fixture?.destroy();
  });

  it('renders the "N of M done" summary and one bar segment per sub-item by default', async () => {
    await render([subItem('done', 1), subItem('not_started', 2), subItem('in_progress', 3)]);

    expect(byTestId('formation-sub-item-list-summary')?.textContent).toContain('1 of 3 done');

    const bar = byTestId('formation-sub-item-list-bar');
    expect(bar?.getAttribute('role')).toBe('img');
    // Same sentence the row disclosure's bar announces — one shared helper, so the two can't drift.
    expect(bar?.getAttribute('aria-label')).toBe('1 of 3 sub-items done');
    const segments = Array.from(bar?.children ?? []) as HTMLElement[];
    expect(segments.map((segment) => segment.className)).toEqual([
      expect.stringContaining(FORMATION_ITEM_SEGMENT_COLORS.done),
      expect.stringContaining(FORMATION_ITEM_SEGMENT_COLORS.not_started),
      expect.stringContaining(FORMATION_ITEM_SEGMENT_COLORS.in_progress),
    ]);
  });

  // The row's disclosure trigger already carries the count and its own mini bar, so the inline
  // expansion passes showSummary=false and renders the rows alone.
  it('hides the summary header and bar when showSummary is false', async () => {
    await render([subItem('done', 1), subItem('not_started', 2)], false);

    expect(byTestId('formation-sub-item-list-summary')).toBeNull();
    expect(byTestId('formation-sub-item-list-bar')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="formation-sub-item-row-"]').length).toBe(2);
  });

  it('leads every row with its status glyph and ends it with the status label as plain text', async () => {
    await render(STATUSES.map((status, index) => subItem(status, index)));

    STATUSES.forEach((status, index) => {
      const row = byTestId(`formation-sub-item-row-sub_${index}`);
      const glyph = row?.querySelector('i');
      // Angular re-orders interpolated class tokens, so assert token membership rather than substring order.
      for (const token of FORMATION_ITEM_STATUS_GLYPHS[status].icon.split(' ')) {
        expect(glyph?.classList.contains(token)).toBe(true);
      }
      expect(glyph?.classList.contains(FORMATION_ITEM_STATUS_GLYPHS[status].colorClass)).toBe(true);
      expect(glyph?.getAttribute('aria-hidden')).toBe('true');
      expect(row?.textContent).toContain(`Sub-item ${index}`);
      expect(row?.textContent).toContain(FORMATION_ITEM_STATUS_LABELS[status]);
    });
    // Status is text, not a chip — the parent item's status pill is the only pill on the surface.
    expect(fixture.nativeElement.querySelector('lfx-tag')).toBeNull();
  });

  // The wire status is an unchecked cast and the mapper passes it through unnormalized, so a value
  // outside the union must degrade (not-started glyph, raw label) rather than crash the template.
  it('renders a status outside the known union with the not-started glyph and the raw value as its label', async () => {
    await render([{ uid: 'sub_future', title: 'Future', status: 'weird_future_status' as FormationItemStatus }]);

    const row = byTestId('formation-sub-item-row-sub_future');
    const glyph = row?.querySelector('i');
    expect(glyph?.classList.contains('fa-circle')).toBe(true);
    expect(row?.textContent).toContain('weird_future_status');
  });
});
