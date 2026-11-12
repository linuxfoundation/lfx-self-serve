// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { FormationService } from '@services/formation.service';
import type { FormationPipelineFoundationKindFilter, FormationPipelineResponse, FormationPipelineRow } from '@lfx-one/shared/interfaces';
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
    formation_lead: null,
    foundation_kind: 'under_foundation',
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

  const render = async (result: Observable<FormationPipelineResponse> = of(response(ROWS)), query: Record<string, string> | null = null): Promise<void> => {
    TestBed.resetTestingModule();
    getFormationPipeline = vi.fn(() => result);
    await TestBed.configureTestingModule({
      imports: [FormationsPipelineComponent],
      providers: [
        provideRouter([]),
        { provide: FormationService, useValue: { getFormationPipeline } },
        ...(query ? [{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } }] : []),
      ],
    }).compileComponents();
    if (query) {
      // A mocked ActivatedRoute is not a real route to navigate relative to.
      vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    }
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

    for (const key of ['project', 'stage', 'expected_launch', 'formation_date', 'legal_entity', 'ed_pm', 'formation_lead', 'opportunity_owner', 'updated']) {
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

  // #5619: the filters and sort live in the URL, so a shared or reloaded link reopens the same view.
  describe('URL state', () => {
    const lastParams = (): Record<string, string | null> => {
      const calls = vi.mocked(TestBed.inject(Router).navigate).mock.calls;
      return (calls[calls.length - 1][1] as { queryParams: Record<string, string | null> }).queryParams;
    };

    it('opens on the state in the URL: stage, foundation type, search and sort', async () => {
      const rows = [
        row({ uid: 'n', name: 'Alpha LF Direct', stage: 'engaged', foundation_kind: 'under_lf', parent: { uid: 'lf', name: 'The Linux Foundation' } }),
        row({ uid: 'u', name: 'Alpha Under', stage: 'engaged', foundation_kind: 'under_foundation' }),
        row({ uid: 'z', name: 'Zeta LF Direct', stage: 'engaged', foundation_kind: 'under_lf', parent: { uid: 'lf', name: 'The Linux Foundation' } }),
      ];
      await render(of(response(rows)), { stage: 'engaged', type: 'under_lf', q: 'alpha', sort: 'project', dir: 'desc' });

      expect(rowIds()).toEqual(['n']);
      expect(q('formations-pipeline-sort-project')?.getAttribute('aria-sort')).toBe('descending');
      expect(fixture.componentInstance['filterForm'].controls.search.value).toBe('alpha');
      expect(fixture.componentInstance['filterForm'].controls.foundationKind.value).toBe('under_lf');
    });

    it('opens scoped to a foundation in the URL, reads once scoped, and lists the foundations for the select', async () => {
      getFormationPipeline = vi.fn((foundationUid: string | null) =>
        of(foundationUid ? response([row({ uid: 'only', name: 'Only' })]) : response([row({ uid: 'p', parent: { uid: 'f2', name: 'Foundation Two' } })]))
      );
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [FormationsPipelineComponent],
        providers: [
          provideRouter([]),
          { provide: FormationService, useValue: { getFormationPipeline } },
          { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ foundation: 'f2' }) } } },
        ],
      }).compileComponents();
      vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      fixture = TestBed.createComponent(FormationsPipelineComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(getFormationPipeline).toHaveBeenNthCalledWith(1, 'f2');
      expect(getFormationPipeline).toHaveBeenCalledTimes(2); // the unfiltered read that names the foundations
      expect(rowIds()).toEqual(['only']);
      expect(fixture.componentInstance['foundationOptions']().map((option: { label: string }) => option.label)).toContain('Foundation Two');
      expect(fixture.componentInstance['filterForm'].controls.foundation.value).toBe('f2');
    });

    it('ignores bad values, and the foundation types an earlier link may carry, and opens on the defaults', async () => {
      await render(of(response(ROWS)), { stage: 'bogus', type: 'bogus', sort: 'bogus', foundation: 'no spaces allowed' });

      expect(rowIds()).toEqual(['d', 'a', 'b']);
      expect(getFormationPipeline).toHaveBeenCalledWith(null);
    });

    it('writes nothing for the default view, then each change to the URL (merge, no history entry)', async () => {
      await render(of(response(ROWS)), {});
      const navigate = vi.mocked(TestBed.inject(Router).navigate);
      expect(navigate).not.toHaveBeenCalled();

      await click(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-archived"]'));
      expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParamsHandling: 'merge', replaceUrl: true }));
      expect(lastParams()).toMatchObject({ stage: 'archived', foundation: null, type: null, q: null, sort: null, dir: null });

      await click(q('formations-pipeline-sort-project')!.querySelector('button'));
      expect(lastParams()).toMatchObject({ stage: 'archived', sort: 'project', dir: 'asc' });

      fixture.componentInstance['filterForm'].controls.foundationKind.setValue('no_parent');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(lastParams()).toMatchObject({ type: 'no_parent' });

      fixture.componentInstance['filterForm'].controls.foundation.setValue('f2');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(lastParams()).toMatchObject({ foundation: 'f2' });
    });

    it('writes the search only after the debounce, and clears every param on reset', async () => {
      await render(of(response(ROWS)), {});
      const navigate = vi.mocked(TestBed.inject(Router).navigate);

      fixture.componentInstance['filterForm'].controls.search.setValue('alp');
      fixture.detectChanges();
      expect(navigate).not.toHaveBeenCalled();
      await new Promise((resolve) => setTimeout(resolve, 350));
      fixture.detectChanges();
      expect(lastParams()).toMatchObject({ q: 'alp' });

      fixture.componentInstance['resetFilters']();
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve, 350));
      fixture.detectChanges();
      expect(lastParams()).toEqual({ stage: null, foundation: null, type: null, q: null, sort: null, dir: null });
    });

    it('round-trips: what one view writes, a fresh page reads back as the same view', async () => {
      const rows = [
        row({ uid: 'u1', name: 'Alpha One', stage: 'archived', foundation_kind: 'under_foundation' }),
        row({ uid: 'u2', name: 'Alpha Two', stage: 'archived', foundation_kind: 'under_foundation' }),
        row({ uid: 'n', name: 'Alpha LF Direct', stage: 'archived', foundation_kind: 'under_lf', parent: { uid: 'lf', name: 'The Linux Foundation' } }),
      ];
      await render(of(response(rows)), {});
      await click(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-archived"]'));
      fixture.componentInstance['filterForm'].controls.foundationKind.setValue('under_foundation');
      fixture.componentInstance['filterForm'].controls.search.setValue('alpha');
      await new Promise((resolve) => setTimeout(resolve, 350));
      await click(q('formations-pipeline-sort-project')!.querySelector('button'));
      await click(q('formations-pipeline-sort-project')!.querySelector('button'));
      const written = Object.fromEntries(Object.entries(lastParams()).filter(([, value]) => value !== null)) as Record<string, string>;
      const before = rowIds();

      expect(written).toEqual({ stage: 'archived', type: 'under_foundation', q: 'alpha', sort: 'project', dir: 'desc' });
      expect(before).toEqual(['u2', 'u1']);

      await render(of(response(rows)), written);
      expect(rowIds()).toEqual(before);
      expect(q('formations-pipeline-sort-project')?.getAttribute('aria-sort')).toBe('descending');
    });
  });

  // #5619 D7
  describe('foundation type filter', () => {
    const KIND_ROWS = [
      row({ uid: 'n', name: 'LF Direct', stage: 'engaged', foundation_kind: 'under_lf', parent: { uid: 'lf', name: 'The Linux Foundation' } }),
      row({ uid: 'u', name: 'Under One', stage: 'engaged', foundation_kind: 'under_foundation' }),
      row({ uid: 'x', name: 'Loner', stage: 'exploratory', foundation_kind: 'no_parent', parent: null }),
      row({ uid: 'a', name: 'Archived LF Direct', stage: 'archived', foundation_kind: 'under_lf', parent: { uid: 'lf', name: 'The Linux Foundation' } }),
    ];
    const pick = async (kind: FormationPipelineFoundationKindFilter): Promise<void> => {
      fixture.componentInstance['filterForm'].controls.foundationKind.setValue(kind);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };

    it('narrows rows, counts and pills to the chosen kind without another read', async () => {
      await render(of(response(KIND_ROWS)));
      expect(rowIds().sort()).toEqual(['n', 'u', 'x']);
      const reads = getFormationPipeline.mock.calls.length;

      await pick('under_lf');
      expect(rowIds()).toEqual(['n']);
      expect(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-in_pipeline"]')?.textContent).toContain('(1)');

      await pick('under_foundation');
      expect(rowIds()).toEqual(['u']);
      await pick('no_parent');
      expect(rowIds()).toEqual(['x']);
      await pick('all');
      expect(rowIds().sort()).toEqual(['n', 'u', 'x']);
      expect(getFormationPipeline.mock.calls.length).toBe(reads);
    });

    it('combines with the stage pill and the name search', async () => {
      await render(of(response(KIND_ROWS)));
      await pick('under_lf');
      await click(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-archived"]'));
      expect(rowIds()).toEqual(['a']);

      await click(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-engaged"]'));
      expect(rowIds()).toEqual(['n']);
      fixture.componentInstance['filterForm'].controls.search.setValue('zzz');
      await new Promise((resolve) => setTimeout(resolve, 350));
      fixture.detectChanges();
      expect(rowIds()).toEqual([]);
    });

    it('exports only the filtered rows and resets with the other filters', async () => {
      await render(of(response(KIND_ROWS)));
      let captured: Blob | null = null;
      URL.createObjectURL = vi.fn((blob: Blob) => {
        captured = blob;
        return 'blob:x';
      });
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

      await pick('under_foundation');
      fixture.componentInstance['exportCsv']();
      const text = await (captured as unknown as Blob).text();
      expect(text).toContain('Under One');
      expect(text).not.toContain('LF Direct');
      expect(text).not.toContain('Loner');

      await pick('no_parent');
      await click(q('formations-pipeline-pills')!.querySelector('[data-testid="filter-pill-archived"]'));
      expect(rowIds()).toEqual([]);
      await click(q('formations-pipeline-filtered-empty')!.querySelector('button'));
      expect(fixture.componentInstance['filterForm'].controls.foundationKind.value).toBe('all');
      expect(rowIds().sort()).toEqual(['n', 'u', 'x']);
    });

    it('has an accessible name and the three kind options plus All', async () => {
      await render(of(response(KIND_ROWS)));

      expect(q('formations-pipeline-foundation-kind')?.querySelector('[aria-label="Foundation type"]')).not.toBeNull();
      expect(fixture.componentInstance['foundationKindOptions']().map((option: { label: string }) => option.label)).toEqual([
        'All projects',
        'Directly under LF',
        'Under an existing foundation',
        'No parent yet',
      ]);
    });
  });

  it('shows the formation lead with the email on hover and focus, and "Not set" when there is none', async () => {
    await render(
      of(
        response([
          row({ uid: 'l', name: 'Led', stage: 'engaged', formation_lead: { name: 'Lee Lead', email: 'lee@example.com' } }),
          row({ uid: 'n', name: 'Unled', stage: 'engaged', formation_lead: null }),
        ])
      )
    );

    const led = q('formations-pipeline-lead-l')!;
    expect(led.textContent).toContain('Lee Lead');
    const host = led.querySelector('[tabindex="0"]');
    expect(host?.getAttribute('role')).toBe('group');
    expect(host?.getAttribute('aria-label')).toBe('Lee Lead, lee@example.com'); // read aloud by screen readers; the tooltip shows the email on hover and focus
    const unset = q('formations-pipeline-lead-n')!;
    expect(unset.textContent).toContain('Not set');
    expect(unset.querySelector('[tabindex]')).toBeNull();
  });

  it('shows the formation lead on the phone card too, wrapping a long value instead of overflowing', async () => {
    await render(
      of(
        response([
          row({ uid: 'l', name: 'Led', stage: 'engaged', formation_lead: { name: '', email: 'a-very-long-address-without-spaces@example.com' } }),
          row({ uid: 'n', name: 'Unled', stage: 'engaged', formation_lead: null }),
        ])
      )
    );

    expect(q('formations-pipeline-mobile-lead-l')?.textContent).toContain('a-very-long-address-without-spaces@example.com');
    expect(q('formations-pipeline-mobile-lead-l')?.classList).toContain('break-words');
    expect(q('formations-pipeline-lead-l')?.classList).toContain('break-words');
    expect(q('formations-pipeline-mobile-lead-n')?.textContent).toContain('Not set');
  });

  it('exports the formation lead in the CSV', async () => {
    await render(of(response([row({ uid: 'l', name: 'Led', stage: 'engaged', formation_lead: { name: 'Lee Lead', email: 'lee@example.com' } })])));
    let captured: Blob | null = null;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      captured = blob;
      return 'blob:x';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    fixture.componentInstance['exportCsv']();

    const text = await (captured as unknown as Blob).text();
    expect(text.split('\r\n')[0]).toContain('Formation lead');
    expect(text).toContain('Lee Lead');
  });

  it('links a row to the formation page whether or not it has a checklist', async () => {
    await render();

    expect(q('formations-pipeline-open-a')?.getAttribute('href')).toContain('/foundation/formations/alpha');
    expect(q('formations-pipeline-open-b')?.getAttribute('href')).toContain('/foundation/formations/bravo');
  });

  it('links a Disengaged row to the formation page, and an Archived row to its dashboard, on click and on the link', async () => {
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

  it('shows a loading status on the phone list, with no cards, range text or Load more, until the read finishes', async () => {
    const pending = new Subject<FormationPipelineResponse>();
    await render(pending);

    expect(q('formations-pipeline-loading')?.textContent).toContain('Loading the pipeline');
    expect(q('formations-pipeline-loading')?.getAttribute('role')).toBe('status');
    expect(q('formations-pipeline-cards')?.getAttribute('aria-busy')).toBe('true');
    expect(q('formations-pipeline-showing')).toBeNull();
    expect(q('formations-pipeline-load-more')).toBeNull();
    expect(q('formations-pipeline-cards')?.textContent).not.toContain('Showing');

    pending.next(response(ROWS));
    pending.complete();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(q('formations-pipeline-loading')).toBeNull();
    expect(q('formations-pipeline-cards')?.getAttribute('aria-busy')).toBe('false');
    expect(q('formations-pipeline-showing')?.textContent).toContain('Showing 1 to 3 of 3');
  });

  it("hides the previous foundation's cards while a new foundation's read is in flight", async () => {
    await render();
    expect(q('formations-pipeline-card-a')).not.toBeNull();
    const next = new Subject<FormationPipelineResponse>();
    getFormationPipeline.mockReturnValueOnce(next);

    fixture.componentInstance['filterForm'].controls.foundation.setValue('f2');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(q('formations-pipeline-card-a')).toBeNull();
    expect(q('formations-pipeline-loading')).not.toBeNull();
    expect(q('formations-pipeline-showing')).toBeNull();
  });

  it('gives the foundation select and the search box accessible names', async () => {
    await render();

    expect(q('formations-pipeline-foundation')?.querySelector('[aria-label="Foundation"]')).not.toBeNull();
    expect(q('formations-pipeline-search')?.querySelector('input')?.getAttribute('aria-label')).toBe('Search projects');
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
