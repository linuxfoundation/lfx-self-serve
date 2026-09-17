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
    sub_stage_raw: 'Formation - Engaged',
    lifecycle: 'formation',
    gates_cleared: false,
    is_activating: false,
    announcement_date: null,
    progress: { not_started: 1, in_progress: 1, blocked: 0, done: 1, skipped: 0 },
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
      buildRow({ formation_uid: 'formation:more-open', progress: { not_started: 3, in_progress: 0, blocked: 0, done: 0, skipped: 0 } }),
      buildRow({
        formation_uid: 'formation:fewer-open',
        progress: { not_started: 0, in_progress: 0, blocked: 0, done: 3, skipped: 0 },
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
        progress: { not_started: 0, in_progress: 0, blocked: 0, done: 0, skipped: 3 },
      }),
    ]);

    const progressText = fixture.nativeElement.querySelector('[data-testid="formations-table-row-formation:all-skipped"] td:nth-child(3) span').textContent;
    expect(progressText.trim()).toBe('3 of 3');
  });

  // LFXV2-3386: the row link opens the checklist drill-down in the foundation context — never
  // `/project/overview?project=<child>`, which handed the whole project context to the child.
  it('links the row name to the foundation formations drill-down for the row project', async () => {
    await render([buildRow({ formation_uid: 'formation:link' })]);

    const anchor = fixture.nativeElement.querySelector('[data-testid="formations-table-open-formation:link"]') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('/foundation/formations/test-project');
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

  it('renders the raw upstream sub_stage verbatim in a muted chip when sub_stage has no queue-taxonomy equivalent (GH-2366)', async () => {
    await render([buildRow({ formation_uid: 'formation:unmapped', sub_stage: null, sub_stage_raw: 'Active' })]);

    const stageCell = fixture.nativeElement.querySelector('[data-testid="formations-table-stage-formation:unmapped"]');
    expect(stageCell.textContent.trim()).toBe('Active');
  });

  it('renders the canonical label for a mapped sub_stage', async () => {
    await render([buildRow({ formation_uid: 'formation:mapped', sub_stage: 'engaged', sub_stage_raw: 'Formation - Engaged' })]);

    const stageCell = fixture.nativeElement.querySelector('[data-testid="formations-table-stage-formation:mapped"]');
    expect(stageCell.textContent.trim()).toBe('Formation · Engaged');
  });

  it('renders the announcement date with the year (GH-2371)', async () => {
    await render([buildRow({ formation_uid: 'formation:dated', announcement_date: '2026-06-30' })]);

    const announcementCell = fixture.nativeElement.querySelector('[data-testid="formations-table-announcement-formation:dated"]');
    expect(announcementCell.textContent.trim()).toBe('Jun 30, 2026');
  });

  it('renders "Not set" when there is no announcement date', async () => {
    await render([buildRow({ formation_uid: 'formation:no-announcement', announcement_date: null })]);

    const announcementCell = fixture.nativeElement.querySelector('[data-testid="formations-table-announcement-formation:no-announcement"]');
    expect(announcementCell.textContent.trim()).toBe('Not set');
  });

  // The announcement date is date-only (YYYY-MM-DD, no time component). `formatAnnouncementDateLabel`
  // parses it as UTC midnight and renders it pinned to UTC (GH-2371), so every viewer sees the same
  // calendar date regardless of local timezone — lock that in against a future refactor that swaps
  // in a local-timezone parse, which would land a day early west of UTC.
  it('does not shift the announcement date for a viewer west of UTC', async () => {
    const originalTz = process.env['TZ'];
    process.env['TZ'] = 'Pacific/Honolulu'; // UTC-10, no DST — the timezone most likely to expose an off-by-one
    try {
      await render([buildRow({ formation_uid: 'formation:tz', announcement_date: '2026-01-01' })]);
      const announcementCell = fixture.nativeElement.querySelector('[data-testid="formations-table-announcement-formation:tz"]');
      expect(announcementCell.textContent.trim()).toBe('Jan 1, 2026');
    } finally {
      if (originalTz === undefined) delete process.env['TZ'];
      else process.env['TZ'] = originalTz;
    }
  });

  // GH-2571: 0 of 6 <th> carried `scope="col"`, and `[ariaLabel]="'Formations queue'"` on
  // `<lfx-table>` silently did nothing — PrimeNG's `Table` declares no `ariaLabel` `@Input`, so the
  // binding landed on `<lfx-table>`'s outer host, never the real `<table role="table">` it renders.
  // Without `scope`, a screen reader can't reliably tie a cell to its header across 129 prod rows.
  describe('table structure and accessible name (GH-2571)', () => {
    it('gives every column header a scope="col"', async () => {
      await render([buildRow({ formation_uid: 'formation:scope' })]);

      const headers = Array.from(fixture.nativeElement.querySelectorAll('table thead th')) as HTMLTableCellElement[];
      expect(headers).toHaveLength(5);
      expect(headers.every((th) => th.getAttribute('scope') === 'col')).toBe(true);
    });

    it('names the real <table> element via aria-label', async () => {
      await render([buildRow({ formation_uid: 'formation:name' })]);

      const table = fixture.nativeElement.querySelector('table');
      expect(table?.getAttribute('aria-label')).toBe('Formations queue');
    });
  });
});
