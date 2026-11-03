// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Component, computed, effect, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { MoreFiltersToggleComponent } from '@components/more-filters-toggle/more-filters-toggle.component';
import { SelectComponent } from '@components/select/select.component';
import { ORG_LENS_TIME_RANGE_OPTIONS, ORG_TRAINING_GROUP_BY_OPTIONS, ORG_TRAINING_VIEW_QUERY_PARAMS } from '@lfx-one/shared/constants';
import type { OrgDropdownOption, OrgLensTimeRange, OrgTrainingFilterOptions, OrgTrainingFilters, OrgTrainingViewState } from '@lfx-one/shared/interfaces';
import { hasOrgTrainingFilter, parseOrgTrainingViewState, serializeOrgTrainingViewState } from '@lfx-one/shared/utils';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { catchError, combineLatest, distinctUntilChanged, map, of, switchMap } from 'rxjs';

const FILTER_KEYS = ['foundation', 'project', 'course', 'level', 'format'] as const;
const EMPTY_FILTER_OPTIONS: OrgTrainingFilterOptions = { foundations: [], projects: [], courses: [], levels: [], formats: [] };

/**
 * The one filter bar of Training & Certification and People › Trainees: range, foundation, project, course, level and
 * format dropdowns (plus a group-by dropdown when `showGroupBy`). The state lives in the URL: it is read from the query
 * params and every pick is written back (other params such as `tab` are kept). Options load for the current range; a
 * selection they do not list stays applied and visible (never silently dropped), and Clear all removes it.
 * Search (projected by the host page, first in the row), range and group-by are always visible; the five filters sit
 * behind the shared "More filters" toggle, whose label counts the ones set. The expanded state is for the visit only,
 * as on Code Contributions.
 */
@Component({
  selector: 'lfx-org-training-filter-bar',
  imports: [ReactiveFormsModule, ButtonComponent, MoreFiltersToggleComponent, SelectComponent],
  templateUrl: './org-training-filter-bar.component.html',
})
export class OrgTrainingFilterBarComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly trainingService = inject(OrgLensTrainingService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  public readonly showGroupBy = input<boolean>(false);

  protected readonly moreFiltersExpanded = signal(false);

  protected readonly rangeOptions: OrgDropdownOption[] = ORG_LENS_TIME_RANGE_OPTIONS.map((option) => ({ label: option.label, value: option.value }));
  protected readonly groupByOptions: OrgDropdownOption[] = ORG_TRAINING_GROUP_BY_OPTIONS.map((option) => ({ label: option.label, value: option.value }));

  public readonly form = new FormGroup({
    range: new FormControl<string>('', { nonNullable: true }),
    foundation: new FormControl<string>('', { nonNullable: true }),
    project: new FormControl<string>('', { nonNullable: true }),
    course: new FormControl<string>('', { nonNullable: true }),
    level: new FormControl<string>('', { nonNullable: true }),
    format: new FormControl<string>('', { nonNullable: true }),
    groupBy: new FormControl<string>('', { nonNullable: true }),
  });

  private readonly state: Signal<OrgTrainingViewState> = toSignal(
    this.route.queryParamMap.pipe(map((params) => parseOrgTrainingViewState((key) => params.get(key)))),
    { initialValue: parseOrgTrainingViewState((key) => this.route.snapshot.queryParamMap.get(key)) }
  );
  private readonly range: Signal<OrgLensTimeRange> = computed(() => this.state().range);
  private readonly options: Signal<OrgTrainingFilterOptions> = this.initOptions();

  protected readonly hasFilter: Signal<boolean> = computed(() => hasOrgTrainingFilter(this.state()));
  /** Filters set behind the toggle, so a pick from the URL is never invisible while it is collapsed. */
  protected readonly hiddenFilterCount: Signal<number> = computed(() => FILTER_KEYS.filter((key) => this.state()[key] !== null).length);
  protected readonly foundationOptions = this.withAll('All Foundations', 'foundations', 'foundation');
  protected readonly projectOptions = this.withAll('All Projects', 'projects', 'project');
  protected readonly courseOptions = this.withAll('All Courses', 'courses', 'course');
  protected readonly levelOptions = this.withAll('All Levels', 'levels', 'level');
  protected readonly formatOptions = this.withAll('All Formats', 'formats', 'format');

  public constructor() {
    // URL → form (silent: only a pick by the user writes to the URL).
    effect(() => {
      const state = this.state();
      this.form.setValue(
        {
          range: state.range,
          foundation: state.foundation ?? '',
          project: state.project ?? '',
          course: state.course ?? '',
          level: state.level ?? '',
          format: state.format ?? '',
          groupBy: state.groupBy,
        },
        { emitEvent: false }
      );
    });

    // Form → URL.
    this.form.valueChanges.subscribe(() => this.navigate(this.stateFromForm()));
  }

  protected clearAll(): void {
    this.navigate({ ...this.state(), foundation: null, project: null, course: null, level: null, format: null });
  }

  private stateFromForm(): OrgTrainingViewState {
    const value: Record<string, string> = this.form.getRawValue();
    return parseOrgTrainingViewState((key) => value[key]);
  }

  /** Writes the state to the URL, leaving every other query param (the page's `tab`, …) alone; `groupBy` only when this bar owns it. */
  private navigate(next: OrgTrainingViewState): void {
    const queryParams = serializeOrgTrainingViewState(next);
    if (!this.showGroupBy()) delete queryParams[ORG_TRAINING_VIEW_QUERY_PARAMS.groupBy];
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge', replaceUrl: true });
  }

  private initOptions(): Signal<OrgTrainingFilterOptions> {
    const orgUid$ = toObservable(this.accountContext.selectedAccount).pipe(
      map((account) => account.uid),
      distinctUntilChanged()
    );
    return toSignal(
      combineLatest([orgUid$, toObservable(this.range)]).pipe(
        switchMap(([orgUid, range]) => {
          if (!orgUid) return of(EMPTY_FILTER_OPTIONS);
          return this.trainingService.getFilterOptions(orgUid, range).pipe(catchError(() => of(EMPTY_FILTER_OPTIONS)));
        })
      ),
      { initialValue: EMPTY_FILTER_OPTIONS }
    );
  }

  /** "All" first, then the loaded options; a picked value the options do not list (not loaded yet, or none in this range) is kept so the dropdown shows what the numbers are filtered by. */
  private withAll(allLabel: string, list: keyof OrgTrainingFilterOptions, key: keyof OrgTrainingFilters): Signal<OrgDropdownOption[]> {
    return computed(() => {
      const options = this.options()[list];
      const picked = this.state()[key];
      const kept = picked !== null && !options.some((option) => option.value === picked) ? [{ label: picked, value: picked }] : [];
      return [{ label: allLabel, value: '' }, ...kept, ...options];
    });
  }
}
