// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { FormationQueueRow, FormationQueueTiles, FormationsQueueFilterState } from '@lfx-one/shared/interfaces';
import { describe, expect, it, vi } from 'vitest';

import { FormationsTableComponent } from './formations-table.component';

/** A date-only string `days` calendar days from today (UTC, matching `getFormationCalendarDayOffset`), so countdown assertions hold on any day. */
function isoDaysFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

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
    lifecycle: 'live',
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

  const render = async (rows: FormationQueueRow[], tiles?: FormationQueueTiles): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [FormationsTableComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationsTableComponent);
    fixture.componentRef.setInput('rows', rows);
    if (tiles) fixture.componentRef.setInput('tiles', tiles);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const readinessHeaderButton = (): HTMLButtonElement | null => fixture.nativeElement.querySelector('[data-testid="formations-sort-readiness"] button');
  const announcementHeaderButton = (): HTMLButtonElement | null => fixture.nativeElement.querySelector('[data-testid="formations-sort-announcement"] button');
  const rowUidsInOrder = (): (string | null)[] =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-row-index]')).map((el) => (el as HTMLElement).getAttribute('data-testid'));
  const cell = (testId: string): HTMLElement => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string | undefined => cell(testId)?.textContent?.trim();

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
    expect(stageCell.textContent.trim()).toBe('Engaged');
  });

  // The date is the cell's first line; the countdown beneath it is covered by the #2782 block below.
  it('renders the announcement date with the year (GH-2371)', async () => {
    await render([buildRow({ formation_uid: 'formation:dated', announcement_date: '2026-06-30' })]);

    const dateLine = fixture.nativeElement.querySelector('[data-testid="formations-table-announcement-formation:dated"] span');
    expect(dateLine.textContent.trim()).toBe('Jun 30, 2026');
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
      const dateLine = fixture.nativeElement.querySelector('[data-testid="formations-table-announcement-formation:tz"] span');
      expect(dateLine.textContent.trim()).toBe('Jan 1, 2026');
    } finally {
      if (originalTz === undefined) delete process.env['TZ'];
      else process.env['TZ'] = originalTz;
    }
  });

  describe('redesigned cells (#2782)', () => {
    it('renders the entity type under the name, derived from is_foundation and parent_uid', async () => {
      await render([
        buildRow({ formation_uid: 'formation:fnd', is_foundation: true }),
        buildRow({ formation_uid: 'formation:child', parent_uid: 'project:parent' }),
        buildRow({ formation_uid: 'formation:top' }),
      ]);

      expect(text('formations-table-type-formation:fnd')).toBe('Foundation');
      expect(text('formations-table-type-formation:child')).toBe('Child project');
      expect(text('formations-table-type-formation:top')).toBe('Project');
    });

    it('renders one progress segment per non-zero status bucket, resolved work first, with the breakdown as the accessible name', async () => {
      await render([buildRow({ formation_uid: 'formation:bar', progress: { not_started: 10, in_progress: 1, blocked: 2, done: 3, skipped: 1 } })]);

      const bar = cell('formations-table-progress-formation:bar').querySelector('[role="img"]') as HTMLElement;
      expect(bar.getAttribute('aria-label')).toBe('17 items · 3 done · 1 in progress · 2 blocked · 1 skipped · 10 not started');
      expect(bar.getAttribute('tabindex')).toBe('0');
      const fills = Array.from(bar.children).map((segment) => Array.from(segment.classList).find((c) => c.startsWith('bg-')));
      expect(fills).toEqual(['bg-emerald-600', 'bg-amber-500', 'bg-red-500', 'bg-gray-400', 'bg-gray-200']);
      // Visible count still folds skipped into done (see the readiness sort test above).
      expect(text('formations-table-progress-formation:bar')).toContain('4 of 17');
    });

    it('renders an empty track and names the empty checklist for a 0 of 0 row', async () => {
      await render([buildRow({ formation_uid: 'formation:empty', progress: {} })]);

      const bar = cell('formations-table-progress-formation:empty').querySelector('[role="img"]') as HTMLElement;
      expect(bar.getAttribute('aria-label')).toBe('No checklist items');
      expect(bar.children).toHaveLength(1);
      expect(text('formations-table-progress-formation:empty')).toContain('0 of 0');
    });

    it('adds an amber countdown under a passed announcement date and a plain one under an upcoming date', async () => {
      await render([
        buildRow({ formation_uid: 'formation:past', announcement_date: isoDaysFromToday(-10) }),
        buildRow({ formation_uid: 'formation:soon', announcement_date: isoDaysFromToday(42) }),
      ]);

      const past = cell('formations-table-announcement-formation:past');
      expect(past.getAttribute('data-timing')).toBe('past');
      expect(past.querySelectorAll('span')[1].textContent?.trim()).toBe('10 days ago');
      expect(past.querySelectorAll('span')[1].classList.contains('text-amber-600')).toBe(true);

      const soon = cell('formations-table-announcement-formation:soon');
      expect(soon.getAttribute('data-timing')).toBe('upcoming');
      expect(soon.querySelectorAll('span')[1].textContent?.trim()).toBe('In 42 days');
      expect(soon.querySelectorAll('span')[1].classList.contains('text-gray-500')).toBe(true);
    });

    // Upstream's is_activating needs a date once every gating item is done, so that one "Not set"
    // gets a prompt; a plain "Not set" stays a single muted line.
    it('prompts for a date once the gates are cleared, and leaves a plain "Not set" alone', async () => {
      await render([
        buildRow({ formation_uid: 'formation:needed', announcement_date: null, gates_cleared: true }),
        buildRow({ formation_uid: 'formation:unset', announcement_date: null }),
      ]);

      const needed = cell('formations-table-announcement-formation:needed');
      expect(needed.getAttribute('data-timing')).toBe('needed');
      expect(needed.textContent).toContain('Not set');
      expect(needed.textContent).toContain('Needed to activate');

      const unset = cell('formations-table-announcement-formation:unset');
      expect(unset.getAttribute('data-timing')).toBe('unset');
      expect(unset.querySelectorAll('span')).toHaveLength(1);
    });

    it('summarises blockers as a count chip with every title in its tooltip and the first title beneath', async () => {
      await render([buildRow({ formation_uid: 'formation:blocked', blocked_item_titles: ['Charter agreed', 'Contribution agreement'] })]);

      const blocking = cell('formations-table-blocking-formation:blocked');
      expect(blocking.textContent).toContain('2 blocked');
      expect(blocking.textContent).toContain('Charter agreed');
      expect(blocking.textContent).not.toContain('Contribution agreement');
      expect(blocking.querySelector('[aria-label]')?.getAttribute('aria-label')).toContain('Contribution agreement');
    });

    it('moves the "Gates cleared" badge into the Blocking cell when nothing blocks, and shows a dash otherwise', async () => {
      await render([buildRow({ formation_uid: 'formation:cleared', gates_cleared: true }), buildRow({ formation_uid: 'formation:plain' })]);

      expect(text('formations-table-blocking-formation:cleared')).toBe('Gates cleared');
      expect(text('formations-table-progress-formation:cleared')).not.toContain('Gates cleared');
      expect(text('formations-table-blocking-formation:plain')).toBe('—');
    });

    // LFXV2-3386 again: the row click must preserve `?project=` exactly like the name link does.
    it('navigates to the drill-down, preserving query params, when the row itself is clicked', async () => {
      await render([buildRow({ formation_uid: 'formation:click', project_slug: 'click-me' })]);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      cell('formations-table-blocking-formation:click').dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(navigate).toHaveBeenCalledWith(['/foundation/formations', 'click-me'], { queryParamsHandling: 'preserve' });
    });

    it('labels the stage pills with the server-side counts, not the filtered row count', async () => {
      await render([buildRow({ formation_uid: 'formation:only' })], {
        exploratory: 4,
        engaged: 2,
        on_hold: 1,
        total: 7,
        foundations: 1,
        projects: 6,
        unmapped: 0,
        ready: 0,
        blocked: 0,
        blocked_items: 0,
      });

      expect(text('filter-pill-all')).toBe('All (7)');
      expect(text('filter-pill-engaged')).toBe('Engaged (2)');
      expect(text('filter-pill-on_hold')).toBe('On hold (1)');
    });

    it('offers "Reset filters" on a filtered-empty result and re-emits the default filters when clicked', async () => {
      await render([]);
      const emitted: FormationsQueueFilterState[] = [];
      fixture.componentInstance.filtersChange.subscribe((filters) => emitted.push(filters));

      (fixture.nativeElement.querySelector('[data-testid="filter-pill-on_hold"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(text('formations-table-empty')).toContain('No results found');

      const reset = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="formations-table-empty"] button') as NodeListOf<HTMLButtonElement>).find(
        (button) => button.textContent?.includes('Reset filters')
      );
      reset?.click();
      fixture.detectChanges();

      expect(emitted).toEqual([
        { subStage: 'on_hold', search: '' },
        { subStage: undefined, search: '' },
      ]);
      expect(text('formations-table-empty')).toContain('No formations yet');
    });
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
