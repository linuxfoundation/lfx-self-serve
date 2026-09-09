// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FormationQueueRow } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { FormationsTableComponent } from './formations-table.component';

function buildRow(overrides: Partial<FormationQueueRow>): FormationQueueRow {
  return {
    formation_uid: 'formation:test',
    project_uid: 'project:test',
    project_slug: 'test-project',
    project_name: 'Test Project',
    is_foundation: false,
    parent_uid: null,
    sub_stage: 'engaged',
    lifecycle: 'formation',
    gates_cleared: false,
    is_activating: false,
    announcement_date: null,
    progress: { not_started: 1, in_progress: 1, blocked: 0, awaiting_acceptance: 0, done: 1, skipped: 0 },
    blocked_item_titles: [],
    assignees: [],
    ...overrides,
  };
}

describe('FormationsTableComponent', () => {
  let fixture: ComponentFixture<FormationsTableComponent>;

  const render = async (rows: FormationQueueRow[]): Promise<void> => {
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

  const readinessHeaderButton = (): HTMLButtonElement | null => fixture.nativeElement.querySelector('[data-testid="formations-sort-readiness"] button');
  const announcementHeaderButton = (): HTMLButtonElement | null => fixture.nativeElement.querySelector('[data-testid="formations-sort-announcement"] button');
  const rowUidsInOrder = (): (string | null)[] =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-row-index]')).map((el) => (el as HTMLElement).getAttribute('data-testid'));

  it('sorts by readiness (fewest open items first) ascending, then toggles to descending on repeat click', async () => {
    await render([
      buildRow({ formation_uid: 'formation:more-open', progress: { not_started: 3, in_progress: 0, blocked: 0, awaiting_acceptance: 0, done: 0, skipped: 0 } }),
      buildRow({
        formation_uid: 'formation:fewer-open',
        progress: { not_started: 0, in_progress: 0, blocked: 0, awaiting_acceptance: 0, done: 3, skipped: 0 },
      }),
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

  it('counts a skipped item as resolved in the progress column and readiness sort', async () => {
    await render([
      buildRow({
        formation_uid: 'formation:all-skipped',
        progress: { not_started: 0, in_progress: 0, blocked: 0, awaiting_acceptance: 0, done: 0, skipped: 3 },
      }),
    ]);

    const progressText = fixture.nativeElement.querySelector('[data-testid="formations-table-row-formation:all-skipped"] td:nth-child(4) span').textContent;
    expect(progressText.trim()).toBe('3 of 3');
  });

  it('sorts by announcement date ascending by default, with rows lacking a date always last', async () => {
    await render([
      buildRow({ formation_uid: 'formation:no-date', announcement_date: null }),
      buildRow({ formation_uid: 'formation:later', announcement_date: '2026-06-01' }),
      buildRow({ formation_uid: 'formation:earlier', announcement_date: '2026-01-01' }),
    ]);

    expect(rowUidsInOrder()).toEqual([
      'formations-table-row-formation:earlier',
      'formations-table-row-formation:later',
      'formations-table-row-formation:no-date',
    ]);
    expect(fixture.nativeElement.querySelector('[data-testid="formations-sort-announcement"]').getAttribute('aria-sort')).toBe('ascending');

    announcementHeaderButton()?.click();
    fixture.detectChanges();

    expect(rowUidsInOrder()).toEqual([
      'formations-table-row-formation:later',
      'formations-table-row-formation:earlier',
      'formations-table-row-formation:no-date',
    ]);
    expect(fixture.nativeElement.querySelector('[data-testid="formations-sort-announcement"]').getAttribute('aria-sort')).toBe('descending');
  });
});
