// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Formation } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { FormationsTableComponent } from './formations-table.component';

function buildRow(overrides: Partial<Formation>): Formation {
  return {
    uid: 'formation:test',
    parent_project_uid: 'project:test',
    parent_project_slug: 'test-project',
    parent_project_name: 'Test Project',
    entity_type: 'project',
    template_uid: 'template:test',
    template_version: 1,
    sub_stage: 'engaged',
    announcement_date: null,
    is_activating: false,
    gating_items_open: 1,
    gating_items_total: 3,
    blocking_item_title: null,
    subtitle: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('FormationsTableComponent', () => {
  let fixture: ComponentFixture<FormationsTableComponent>;

  const render = async (rows: Formation[]): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [FormationsTableComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationsTableComponent);
    fixture.componentRef.setInput('rows', rows);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const nameCell = (uid: string): HTMLAnchorElement | null => fixture.nativeElement.querySelector(`[data-testid="formations-table-open-${uid}"]`);
  const readinessHeaderButton = (): HTMLButtonElement | null => fixture.nativeElement.querySelector('[data-testid="formations-sort-readiness"] button');
  const announcementHeaderButton = (): HTMLButtonElement | null => fixture.nativeElement.querySelector('[data-testid="formations-sort-announcement"] button');
  const rowUidsInOrder = (): (string | null)[] =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-row-index]')).map((el) => (el as HTMLElement).getAttribute('data-testid'));

  it('indents a child row whose parent formation is present in the current result', async () => {
    await render([
      buildRow({ uid: 'formation:foundation', parent_project_name: 'Acme Foundation', entity_type: 'foundation' }),
      buildRow({ uid: 'formation:child', parent_project_name: 'Acme Child Project', parent_formation_name: 'Acme Foundation', entity_type: 'child_project' }),
    ]);

    expect(nameCell('formation:foundation')?.classList.contains('pl-4')).toBe(false);
    expect(nameCell('formation:child')?.classList.contains('pl-4')).toBe(true);
  });

  it('does not indent a row whose named parent is absent from the current result', async () => {
    await render([buildRow({ uid: 'formation:orphan', parent_project_name: 'Orphan Project', parent_formation_name: 'Not In Result' })]);

    expect(nameCell('formation:orphan')?.classList.contains('pl-4')).toBe(false);
  });

  it('sorts by readiness (fewest open gating items first) ascending, then toggles to descending on repeat click', async () => {
    await render([
      buildRow({ uid: 'formation:more-open', gating_items_open: 3, gating_items_total: 3 }),
      buildRow({ uid: 'formation:fewer-open', gating_items_open: 0, gating_items_total: 3 }),
    ]);

    readinessHeaderButton()?.click();
    fixture.detectChanges();
    expect(rowUidsInOrder()).toEqual(['formations-table-row-formation:fewer-open', 'formations-table-row-formation:more-open']);
    expect(fixture.nativeElement.querySelector('[data-testid="formations-sort-readiness"]').getAttribute('aria-sort')).toBe('ascending');

    readinessHeaderButton()?.click();
    fixture.detectChanges();
    expect(rowUidsInOrder()).toEqual(['formations-table-row-formation:more-open', 'formations-table-row-formation:fewer-open']);
    expect(fixture.nativeElement.querySelector('[data-testid="formations-sort-readiness"]').getAttribute('aria-sort')).toBe('descending');
  });

  it('sorts by announcement date with rows lacking a date always last', async () => {
    await render([
      buildRow({ uid: 'formation:no-date', announcement_date: null }),
      buildRow({ uid: 'formation:later', announcement_date: '2026-06-01' }),
      buildRow({ uid: 'formation:earlier', announcement_date: '2026-01-01' }),
    ]);

    announcementHeaderButton()?.click();
    fixture.detectChanges();

    expect(rowUidsInOrder()).toEqual([
      'formations-table-row-formation:earlier',
      'formations-table-row-formation:later',
      'formations-table-row-formation:no-date',
    ]);
  });
});
