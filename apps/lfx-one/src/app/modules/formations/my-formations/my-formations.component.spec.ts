// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { MyFormationSummary, MyFormationWorkResponse } from '@lfx-one/shared/interfaces';
import { FormationService } from '@services/formation.service';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MyFormationsComponent } from './my-formations.component';

const formation = (overrides: Partial<MyFormationSummary> = {}): MyFormationSummary => ({
  formation_uid: 'formation-1',
  project_uid: 'project-1',
  project_slug: 'acme-project',
  project_name: 'Acme Project',
  sub_stage: 'exploratory',
  sub_stage_raw: 'Formation - Exploratory',
  announcement_date: null,
  assigned_to_do: 1,
  assigned_done: 0,
  assigned_skipped: 0,
  items_done: 0,
  items_total: 2,
  gating_done: 0,
  gating_total: 1,
  blocking_item_title: null,
  ...overrides,
});

const complete = (formations: MyFormationSummary[]): MyFormationWorkResponse => ({ formations, items: [], state: 'complete' });

function rowIds(fixture: ComponentFixture<MyFormationsComponent>): string[] {
  return Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="my-formations-row-"]')).map(
    (row) => (row as HTMLElement).getAttribute('data-testid') ?? ''
  );
}

function byTestId(fixture: ComponentFixture<MyFormationsComponent>, testId: string): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
}

async function settle(fixture: ComponentFixture<MyFormationsComponent>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

async function render(response: MyFormationWorkResponse): Promise<{
  fixture: ComponentFixture<MyFormationsComponent>;
  work$: BehaviorSubject<MyFormationWorkResponse>;
  invalidateMyFormationWork: ReturnType<typeof vi.fn>;
}> {
  const work$ = new BehaviorSubject<MyFormationWorkResponse>(response);
  const invalidateMyFormationWork = vi.fn();

  await TestBed.configureTestingModule({
    imports: [MyFormationsComponent],
    providers: [provideRouter([]), { provide: FormationService, useValue: { getMyFormationWork: () => work$.asObservable(), invalidateMyFormationWork } }],
  }).compileComponents();

  const fixture = TestBed.createComponent(MyFormationsComponent);
  await settle(fixture);
  return { fixture, work$, invalidateMyFormationWork };
}

describe('MyFormationsComponent (#2753)', () => {
  it('renders one table row per formation with its stage chip, your-items subtitle, progress, announcement and blocking gate', async () => {
    const { fixture } = await render(
      complete([
        formation({
          assigned_to_do: 2,
          assigned_done: 1,
          items_done: 1,
          items_total: 4,
          announcement_date: '2026-10-25',
          blocking_item_title: 'Waiting on legal',
        }),
      ])
    );

    expect(rowIds(fixture)).toEqual(['my-formations-row-formation-1']);
    expect(byTestId(fixture, 'my-formations-open-formation-1')?.textContent).toContain('Acme Project');
    expect(byTestId(fixture, 'my-formations-stage-formation-1')?.textContent).toContain('Exploratory');
    expect(byTestId(fixture, 'my-formations-items-formation-1')?.textContent).toContain('2 to do · 1 done');
    expect(byTestId(fixture, 'my-formations-progress-formation-1')?.textContent).toContain('1 of 4');
    expect(byTestId(fixture, 'my-formations-progress-formation-1')?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('25');
    expect(byTestId(fixture, 'my-formations-announcement-formation-1')?.textContent).toContain('Oct 25');
    expect(byTestId(fixture, 'my-formations-blocking-formation-1')?.textContent).toContain('Waiting on legal');
    expect(byTestId(fixture, 'my-formations-error')).toBeNull();
    expect(byTestId(fixture, 'my-formations-empty-state')).toBeNull();
  });

  it('links each formation name to its project checklist page', async () => {
    const { fixture } = await render(complete([formation({ project_slug: 'cascade-data-alliance' })]));

    expect(byTestId(fixture, 'my-formations-open-formation-1')?.getAttribute('href')).toBe('/project/formation?project=cascade-data-alliance');
  });

  it('renders "Not set" and an em dash when a formation has no announcement date and no blocking item', async () => {
    const { fixture } = await render(complete([formation()]));

    expect(byTestId(fixture, 'my-formations-announcement-formation-1')?.textContent).toContain('Not set');
    expect(byTestId(fixture, 'my-formations-blocking-formation-1')?.textContent?.trim()).toBe('—');
  });

  it('renders the raw upstream stage verbatim when sub_stage has no queue-taxonomy equivalent', async () => {
    const { fixture } = await render(complete([formation({ sub_stage: null, sub_stage_raw: 'Formation - Disengaged' })]));

    expect(byTestId(fixture, 'my-formations-stage-formation-1')?.textContent).toContain('Formation - Disengaged');
  });

  it('orders rows by most assigned_to_do first, blocked before unblocked, then nearer announcement_date, then name', async () => {
    // Deliberately fed out of order — the wrong-order fixture the ordering rule must correct.
    const { fixture } = await render(
      complete([
        formation({ formation_uid: 'few-todo', project_name: 'Few Todo', assigned_to_do: 1, announcement_date: '2026-01-01' }),
        formation({ formation_uid: 'unblocked-far', project_name: 'Unblocked Far', assigned_to_do: 3, announcement_date: '2026-12-01' }),
        formation({
          formation_uid: 'blocked-near',
          project_name: 'Blocked Near',
          assigned_to_do: 3,
          blocking_item_title: 'Waiting on legal',
          announcement_date: '2026-06-01',
        }),
        formation({ formation_uid: 'b-name', project_name: 'B Name', assigned_to_do: 3, blocking_item_title: 'x', announcement_date: null }),
        formation({ formation_uid: 'a-name', project_name: 'A Name', assigned_to_do: 3, blocking_item_title: 'x', announcement_date: null }),
      ])
    );

    expect(rowIds(fixture)).toEqual([
      'my-formations-row-blocked-near',
      'my-formations-row-a-name',
      'my-formations-row-b-name',
      'my-formations-row-unblocked-far',
      'my-formations-row-few-todo',
    ]);
  });

  it('filters rows by the stage tab, showing an unmapped-stage row only under All', async () => {
    const { fixture } = await render(
      complete([
        formation({ formation_uid: 'exploratory-1', sub_stage: 'exploratory' }),
        formation({ formation_uid: 'engaged-1', sub_stage: 'engaged', sub_stage_raw: 'Formation - Engaged' }),
        formation({ formation_uid: 'unmapped-1', sub_stage: null, sub_stage_raw: 'Formation - Disengaged' }),
      ])
    );

    expect(rowIds(fixture)).toHaveLength(3);

    (byTestId(fixture, 'filter-pill-engaged') as HTMLButtonElement).click();
    await settle(fixture);

    expect(rowIds(fixture)).toEqual(['my-formations-row-engaged-1']);

    (byTestId(fixture, 'filter-pill-all') as HTMLButtonElement).click();
    await settle(fixture);

    expect(rowIds(fixture)).toHaveLength(3);
  });

  it('filters rows by the debounced search term against the formation name', async () => {
    const { fixture } = await render(
      complete([
        formation({ formation_uid: 'acme', project_name: 'Acme Project' }),
        formation({ formation_uid: 'cascade', project_name: 'Cascade Data Alliance' }),
      ])
    );

    fixture.componentInstance.searchForm.controls.search.setValue('cascade');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle(fixture);

    expect(rowIds(fixture)).toEqual(['my-formations-row-cascade']);
  });

  it('applies the same search term again after Reset filters (the reset clears the debounce memory)', async () => {
    const { fixture } = await render(
      complete([
        formation({ formation_uid: 'acme', project_name: 'Acme Project' }),
        formation({ formation_uid: 'cascade', project_name: 'Cascade Data Alliance' }),
      ])
    );
    const search = fixture.componentInstance.searchForm.controls.search;

    search.setValue('cascade');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle(fixture);
    expect(rowIds(fixture)).toEqual(['my-formations-row-cascade']);

    fixture.componentInstance['resetFilters']();
    await settle(fixture);
    expect(rowIds(fixture)).toHaveLength(2);
    expect(search.value).toBe('');

    search.setValue('cascade');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle(fixture);
    expect(rowIds(fixture)).toEqual(['my-formations-row-cascade']);
  });

  it('sends the paginator back to the first page when a filter narrows the list', async () => {
    const { fixture } = await render(
      complete(
        Array.from({ length: 12 }, (_, i) => formation({ formation_uid: `f-${i}`, project_name: `Project ${i}`, sub_stage: i < 6 ? 'engaged' : 'exploratory' }))
      )
    );
    const component = fixture.componentInstance;

    // Land on page 2, as the paginator would report it.
    component['onPage']({ first: 10, rows: 10 });
    expect(component['first']()).toBe(10);

    (byTestId(fixture, 'filter-pill-engaged') as HTMLButtonElement).click();
    await settle(fixture);

    expect(component['first']()).toBe(0);
    expect(rowIds(fixture)).toHaveLength(6);

    component['onPage']({ first: 10, rows: 10 });
    component.searchForm.controls.search.setValue('Project 1');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle(fixture);

    expect(component['first']()).toBe(0);
  });

  it('shows the in-card "No results" state with a Reset that restores every row', async () => {
    const { fixture } = await render(complete([formation({ formation_uid: 'exploratory-1', sub_stage: 'exploratory' })]));

    (byTestId(fixture, 'filter-pill-engaged') as HTMLButtonElement).click();
    await settle(fixture);

    expect(rowIds(fixture)).toHaveLength(0);
    expect(byTestId(fixture, 'my-formations-no-results')).not.toBeNull();
    expect(byTestId(fixture, 'my-formations-empty-state')).toBeNull();

    (byTestId(fixture, 'my-formations-no-results')?.querySelector('button') as HTMLButtonElement).click();
    await settle(fixture);

    expect(byTestId(fixture, 'my-formations-no-results')).toBeNull();
    expect(rowIds(fixture)).toEqual(['my-formations-row-exploratory-1']);
  });

  it('shows the page-level empty state when the caller has no formations', async () => {
    const { fixture } = await render(complete([]));

    expect(byTestId(fixture, 'my-formations-empty-state')).not.toBeNull();
    expect(byTestId(fixture, 'my-formations-card')).toBeNull();
    expect(byTestId(fixture, 'my-formations-error')).toBeNull();
  });

  it('treats a partial response that still carries rows as data, not an error', async () => {
    const { fixture } = await render({ formations: [formation()], items: [], state: 'partial' });

    expect(rowIds(fixture)).toEqual(['my-formations-row-formation-1']);
    expect(byTestId(fixture, 'my-formations-error')).toBeNull();
  });

  it('shows the error state, not the empty state, for a partial response with no rows', async () => {
    const { fixture } = await render({ formations: [], items: [], state: 'partial' });

    expect(byTestId(fixture, 'my-formations-error')).not.toBeNull();
    expect(byTestId(fixture, 'my-formations-empty-state')).toBeNull();
  });

  it('shows the inline error when the read is unavailable, and Retry re-arms loading, invalidates the shared read and renders the new response', async () => {
    const { fixture, work$, invalidateMyFormationWork } = await render({ formations: [], items: [], state: 'unavailable' });

    expect(byTestId(fixture, 'my-formations-error')).not.toBeNull();
    expect(byTestId(fixture, 'my-formations-empty-state')).toBeNull();

    (byTestId(fixture, 'my-formations-retry') as HTMLButtonElement).click();
    await settle(fixture);

    expect(invalidateMyFormationWork).toHaveBeenCalledTimes(1);
    // Loading again: the error box yields to the (loading) table until the re-fetch lands.
    expect(byTestId(fixture, 'my-formations-error')).toBeNull();
    expect(byTestId(fixture, 'my-formations-table')).not.toBeNull();

    work$.next(complete([formation()]));
    await settle(fixture);

    expect(rowIds(fixture)).toEqual(['my-formations-row-formation-1']);
    expect(byTestId(fixture, 'my-formations-error')).toBeNull();
  });
});
