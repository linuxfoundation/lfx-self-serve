// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { FormationService } from '@services/formation.service';
import type { FormationPipelineResponse, FormationPipelineRow } from '@lfx-one/shared/interfaces';
import { countPipelineRows } from '@lfx-one/shared/utils';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FormationsPipelineComponent } from './formations-pipeline.component';

function row(overrides: Partial<FormationPipelineRow>): FormationPipelineRow {
  return {
    uid: 'u',
    slug: 'slug',
    name: 'Project',
    stage: 'exploratory',
    parent: { uid: 'f1', name: 'Foundation One' },
    announcement_date: null,
    formation_date: null,
    legal_entity_name: null,
    legal_entity_type: null,
    executive_director: null,
    program_manager: null,
    opportunity_owner: null,
    created_at: null,
    updated_at: null,
    has_checklist: false,
    ...overrides,
  };
}

const ROWS: FormationPipelineRow[] = [
  row({ uid: 'a', slug: 'alpha', name: 'Alpha', stage: 'engaged', announcement_date: '2999-01-01T00:00:00Z', has_checklist: true }),
  row({ uid: 'b', slug: 'bravo', name: 'Bravo', stage: 'prospect' }),
  row({ uid: 'c', slug: 'charlie', name: '=Charlie', stage: 'archived', announcement_date: '2998-01-01T00:00:00Z' }),
  row({
    uid: 'd',
    slug: 'delta',
    name: 'Delta',
    stage: 'exploratory',
    announcement_date: '2997-01-01T00:00:00Z',
    parent: { uid: 'f2', name: 'Foundation Two' },
  }),
];

function response(rows: FormationPipelineRow[]): FormationPipelineResponse {
  return { rows, counts: countPipelineRows(rows) };
}

describe('FormationsPipelineComponent (#5475)', () => {
  let fixture: ComponentFixture<FormationsPipelineComponent>;
  let getFormationPipeline: ReturnType<typeof vi.fn>;

  const render = async (result: Observable<FormationPipelineResponse> = of(response(ROWS))): Promise<void> => {
    TestBed.resetTestingModule();
    getFormationPipeline = vi.fn(() => result);
    await TestBed.configureTestingModule({
      imports: [FormationsPipelineComponent],
      providers: [provideRouter([]), { provide: FormationService, useValue: { getFormationPipeline } }],
    }).compileComponents();
    fixture = TestBed.createComponent(FormationsPipelineComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const q = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const rowIds = (): string[] =>
    [...fixture.nativeElement.querySelectorAll('[data-testid^="formations-pipeline-row-"]')].map((el: Element) =>
      (el as HTMLElement).dataset['testid']!.replace('formations-pipeline-row-', '')
    );
  const click = async (el: HTMLElement | null): Promise<void> => {
    el?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('opens on the live pipeline (Draft, Exploratory, Engaged, On hold), upcoming launches first, Not set last', async () => {
    await render();

    expect(getFormationPipeline).toHaveBeenCalledWith(null);
    expect(rowIds()).toEqual(['d', 'a', 'b']);
    expect(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-in_pipeline"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps Archived and Disengaged out of the default view until their pill is chosen', async () => {
    await render(of(response([...ROWS, row({ uid: 'e', name: 'Echo', stage: 'disengaged' })])));
    expect(rowIds()).not.toContain('c');
    expect(rowIds()).not.toContain('e');

    await click(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-archived"]'));
    expect(rowIds()).toEqual(['c']);
    await click(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-all"]'));
    expect(rowIds()).toHaveLength(5);
  });

  it('shows Overdue, amber, for a past launch on a live row but not on an archived one', async () => {
    await render(
      of(
        response([
          row({ uid: 'o', name: 'Late', stage: 'engaged', announcement_date: '2020-01-01T00:00:00Z' }),
          row({ uid: 'z', name: 'Done', stage: 'archived', announcement_date: '2020-01-01T00:00:00Z' }),
        ])
      )
    );
    expect(q('formations-pipeline-launch-o')?.getAttribute('data-overdue')).toBe('true');
    expect(q('formations-pipeline-launch-o')?.textContent).toContain('Overdue');

    await click(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-archived"]'));
    expect(q('formations-pipeline-launch-z')?.getAttribute('data-overdue')).toBe('false');
    expect(q('formations-pipeline-launch-z')?.textContent).not.toContain('Overdue');
  });

  it('builds pills with counts, hiding Disengaged and Confidential at zero', async () => {
    await render();

    const pills = [...fixture.nativeElement.querySelectorAll('[data-testid="formations-pipeline-pills"] button')].map((el: Element) => el.textContent?.trim());
    expect(pills).toEqual(['In pipeline (3)', 'All (4)', 'Draft (1)', 'Exploratory (1)', 'Engaged (1)', 'On hold (0)', 'Archived (1)']);
  });

  it('filters the rows by a stage pill and by a stat card, and clears on the second click', async () => {
    await render();

    await click(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-engaged"]'));
    expect(rowIds()).toEqual(['a']);

    await click(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-in_pipeline"]'));
    expect(rowIds()).toHaveLength(3);

    const card = fixture.nativeElement.querySelector('[data-testid="formations-pipeline-stats"] button');
    expect(card).not.toBeNull();
  });

  it('sorts on every column and keeps Not set last', async () => {
    await render();
    await click(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-all"]'));

    for (const key of ['project', 'stage', 'expected_launch', 'formation_date', 'legal_entity', 'ed_pm', 'opportunity_owner', 'updated']) {
      await click(q(`formations-pipeline-sort-${key}`)!.querySelector('button'));
      expect(q(`formations-pipeline-sort-${key}`)?.getAttribute('aria-sort')).toBe('ascending');
      expect(rowIds()).toHaveLength(4);
    }

    await click(q('formations-pipeline-sort-project')!.querySelector('button'));
    expect(rowIds()).toEqual(['c', 'a', 'b', 'd']);
    await click(q('formations-pipeline-sort-project')!.querySelector('button'));
    expect(q('formations-pipeline-sort-project')?.getAttribute('aria-sort')).toBe('descending');
    expect(rowIds()).toEqual(['d', 'b', 'a', 'c']);
  });

  it('links a row to its checklist only when it has one, otherwise to the project dashboard', async () => {
    await render();

    expect(q('formations-pipeline-open-a')?.getAttribute('href')).toContain('/foundation/formations/alpha');
    expect(q('formations-pipeline-open-b')?.getAttribute('href')).toContain('/project/overview');
    expect(q('formations-pipeline-open-b')?.getAttribute('href')).toContain('project=bravo');
  });

  it('links a Disengaged row with a checklist to it, and an Archived row with one to its dashboard, on click and on the link', async () => {
    await render(
      of(
        response([
          row({ uid: 'dis', slug: 'dis-slug', name: 'Dis', stage: 'disengaged', has_checklist: true }),
          row({ uid: 'arc', slug: 'arc-slug', name: 'Arc', stage: 'archived', has_checklist: true }),
        ])
      )
    );
    await click(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-all"]'));

    expect(q('formations-pipeline-open-dis')?.getAttribute('href')).toContain('/foundation/formations/dis-slug');
    expect(q('formations-pipeline-open-arc')?.getAttribute('href')).toContain('/project/overview');
    expect(q('formations-pipeline-open-arc')?.getAttribute('href')).toContain('project=arc-slug');

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const rows = fixture.componentInstance['displayRows']();
    fixture.componentInstance['onRowSelect']({ data: rows.find((r) => r.uid === 'dis')! });
    fixture.componentInstance['onRowSelect']({ data: rows.find((r) => r.uid === 'arc')! });
    expect(navigate).toHaveBeenNthCalledWith(1, ['/foundation/formations', 'dis-slug'], { queryParamsHandling: 'preserve' });
    expect(navigate).toHaveBeenNthCalledWith(2, ['/project/overview'], { queryParams: { project: 'arc-slug' } });
  });

  it('shows the amber state only for a launch within 30 days', async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
    await render(
      of(response([row({ uid: 'x', name: 'Soon', announcement_date: soon }), row({ uid: 'y', name: 'Later', announcement_date: '2999-01-01T00:00:00Z' })]))
    );

    expect(q('formations-pipeline-launch-x')?.getAttribute('data-soon')).toBe('true');
    expect(q('formations-pipeline-launch-y')?.getAttribute('data-soon')).toBe('false');
  });

  it('offers the foundations seen in the unfiltered read and sends the chosen one to the BFF', async () => {
    await render();

    fixture.componentInstance['filterForm'].controls.foundation.setValue('f2');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getFormationPipeline).toHaveBeenLastCalledWith('f2');
    expect(fixture.componentInstance['foundationOptions']().map((option: { label: string }) => option.label)).toEqual([
      'All foundations',
      'Foundation One',
      'Foundation Two',
    ]);
  });

  it('filters by name client-side after a debounce, with counts following, and makes no second read', async () => {
    vi.useFakeTimers();
    try {
      await render();
      fixture.componentInstance['filterForm'].controls.search.setValue('alph');
      await vi.advanceTimersByTimeAsync(200);
      fixture.detectChanges();
      expect(rowIds()).toHaveLength(3);

      await vi.advanceTimersByTimeAsync(150);
      fixture.detectChanges();
      expect(rowIds()).toEqual(['a']);
      expect(fixture.componentInstance['counts']()).toMatchObject({ engaged: 1, total: 1 });
      expect(getFormationPipeline).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels an in-flight foundation read when the foundation changes again', async () => {
    const first = new Subject<FormationPipelineResponse>();
    const second = new Subject<FormationPipelineResponse>();
    await render(of(response(ROWS)));
    getFormationPipeline.mockReturnValueOnce(first).mockReturnValueOnce(second);

    fixture.componentInstance['filterForm'].controls.foundation.setValue('f1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance['filterForm'].controls.foundation.setValue('f2');
    fixture.detectChanges();
    await fixture.whenStable();

    second.next(response([row({ uid: 'z', name: 'Zed' })]));
    second.complete();
    first.next(response([row({ uid: 'stale', name: 'Stale' })]));
    fixture.detectChanges();

    expect(rowIds()).toEqual(['z']);
    expect(first.observed).toBe(false);
  });

  it('exports the filtered rows across all pages as CSV with the dated file name and neutralized formulas', async () => {
    await render();
    let captured: Blob | null = null;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      captured = blob;
      return 'blob:x';
    });
    URL.revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await click(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-archived"]'));
    fixture.componentInstance['exportCsv']();

    const text = await (captured as unknown as Blob).text();
    // Blob.text() strips a UTF-8 BOM, so read the raw bytes: EF BB BF is what lets Excel detect the encoding.
    expect([...new Uint8Array(await (captured as unknown as Blob).arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text.split('\r\n')).toHaveLength(2);
    expect(text).toContain("'=Charlie");
    expect(anchorClick).toHaveBeenCalled();
  });

  it('shows the empty state with no rows and the filtered-empty state, with a reset, once a filter hides everything', async () => {
    await render(of(response([])));
    expect(q('formations-pipeline-empty')).not.toBeNull();

    await render();
    await click(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-on_hold"]'));
    expect(q('formations-pipeline-filtered-empty')).not.toBeNull();
  });

  it('shows the forbidden message for a 403 and a retryable error otherwise', async () => {
    await render(throwError(() => new HttpErrorResponse({ status: 403 })));
    expect(q('formations-pipeline-error')?.textContent).toContain('Only the formation team can see the pipeline.');
    expect(q('formations-pipeline-retry')).toBeNull();

    await render(throwError(() => new HttpErrorResponse({ status: 500 })));
    expect(q('formations-pipeline-error')?.textContent).toContain("Couldn't load the pipeline. Try again.");
    await click(q('formations-pipeline-retry'));
    expect(getFormationPipeline).toHaveBeenCalledTimes(2);
  });
});
