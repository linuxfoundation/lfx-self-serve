// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FORMATION_ITEM_STATUS_LABELS, FORMATION_SUB_ITEM_MARKERS, FORMATION_SUB_ITEM_UNKNOWN_LABEL_CLASS } from '@lfx-one/shared/constants';
import { FormationItemStatus, FormationSubItem } from '@lfx-one/shared/interfaces';
import { afterEach, describe, expect, it } from 'vitest';

import { FormationSubItemListComponent } from './formation-sub-item-list.component';

const STATUSES: FormationItemStatus[] = ['done', 'in_progress', 'blocked', 'skipped', 'not_started'];
/** The statuses whose label is visible text — done and not started say it with the marker alone (#2818). */
const LABELLED_STATUSES: FormationItemStatus[] = ['in_progress', 'blocked', 'skipped'];

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
  const inRow = (uid: string, part: 'marker' | 'title' | 'status'): HTMLElement | null =>
    byTestId(`formation-sub-item-row-${uid}`)?.querySelector(`[data-testid="formation-sub-item-${part}"]`) ?? null;

  afterEach(() => {
    fixture?.destroy();
  });

  it('renders the "N of M done" summary with a progress ring by default', async () => {
    await render([subItem('done', 1), subItem('not_started', 2), subItem('in_progress', 3), subItem('blocked', 4)]);

    expect(byTestId('formation-sub-item-list-summary')?.textContent).toContain('1 of 4 done');
    expect(byTestId('formation-progress-ring')).not.toBeNull();
    // Only done counts toward the fill — one of four closes a quarter of the 100-unit path.
    expect(byTestId('formation-progress-ring-fill')?.getAttribute('stroke-dasharray')).toBe('25 100');
  });

  // The row's disclosure trigger already carries the count and its own ring, so the inline
  // expansion passes showSummary=false and renders the rows alone.
  it('hides the summary and ring when showSummary is false', async () => {
    await render([subItem('done', 1), subItem('not_started', 2)], false);

    expect(byTestId('formation-sub-item-list-summary')).toBeNull();
    expect(byTestId('formation-progress-ring')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="formation-sub-item-row-"]').length).toBe(2);
  });

  it('leads every row with its status marker and tones the title by status', async () => {
    await render(STATUSES.map((status, index) => subItem(status, index)));

    STATUSES.forEach((status, index) => {
      const marker = inRow(`sub_${index}`, 'marker');
      for (const token of FORMATION_SUB_ITEM_MARKERS[status].markerClass.split(' ')) {
        expect(marker?.classList.contains(token)).toBe(true);
      }
      expect(marker?.getAttribute('aria-hidden')).toBe('true');

      const title = inRow(`sub_${index}`, 'title');
      expect(title?.textContent).toContain(`Sub-item ${index}`);
      for (const token of FORMATION_SUB_ITEM_MARKERS[status].titleClass.split(' ')) {
        expect(title?.classList.contains(token)).toBe(true);
      }
    });
    // Status is text, not a chip — the parent item's status pill is the only pill on the surface.
    expect(fixture.nativeElement.querySelector('lfx-tag')).toBeNull();
  });

  it('fills only the done marker, with a check', async () => {
    await render([subItem('done', 0), subItem('in_progress', 1), subItem('not_started', 2)]);

    expect(inRow('sub_0', 'marker')?.querySelector('i.fa-check')).not.toBeNull();
    expect(inRow('sub_1', 'marker')?.querySelector('i')).toBeNull();
    expect(inRow('sub_2', 'marker')?.querySelector('i')).toBeNull();
  });

  it('keeps every status label in the accessibility tree but shows it only where the marker alone does not say it', async () => {
    await render(STATUSES.map((status, index) => subItem(status, index)));

    STATUSES.forEach((status, index) => {
      const label = inRow(`sub_${index}`, 'status');
      expect(label?.textContent).toContain(FORMATION_ITEM_STATUS_LABELS[status]);
      expect(label?.classList.contains('sr-only')).toBe(!LABELLED_STATUSES.includes(status));
    });
  });

  // The wire status is an unchecked cast and the mapper passes it through unnormalized, so a value
  // outside the union must degrade (not-started marker, raw label shown) rather than crash the template.
  it('renders a status outside the known union with the not-started marker and the raw value as a visible label', async () => {
    await render([{ uid: 'sub_future', title: 'Future', status: 'weird_future_status' as FormationItemStatus }]);

    const marker = inRow('sub_future', 'marker');
    for (const token of FORMATION_SUB_ITEM_MARKERS.not_started.markerClass.split(' ')) {
      expect(marker?.classList.contains(token)).toBe(true);
    }
    const label = inRow('sub_future', 'status');
    expect(label?.textContent).toContain('weird_future_status');
    expect(label?.classList.contains('sr-only')).toBe(false);
    for (const token of FORMATION_SUB_ITEM_UNKNOWN_LABEL_CLASS.split(' ')) {
      expect(label?.classList.contains(token)).toBe(true);
    }
  });
});
