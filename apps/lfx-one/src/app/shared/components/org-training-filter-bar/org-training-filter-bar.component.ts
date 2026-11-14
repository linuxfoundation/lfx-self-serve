// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { MoreFiltersToggleComponent } from '@components/more-filters-toggle/more-filters-toggle.component';
import { SelectComponent } from '@components/select/select.component';
import {
  EMPTY_ORG_TRAINING_FILTER_OPTIONS,
  ORG_LENS_TIME_RANGE_OPTIONS,
  ORG_LENS_TIME_RANGE_QUERY_PARAM,
  ORG_TRAINING_FILTER_KEYS,
  ORG_TRAINING_GROUP_BY_OPTIONS,
  ORG_TRAINING_VIEW_QUERY_PARAMS,
} from '@lfx-one/shared/constants';
import type { OrgDropdownOption, OrgLensTimeRange, OrgTrainingFilterOptions, OrgTrainingFilters, OrgTrainingViewState } from '@lfx-one/shared/interfaces';
import { hasOrgTrainingFilter, parseOrgTrainingViewState, serializeOrgTrainingViewState } from '@lfx-one/shared/utils';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { BehaviorSubject, catchError, combineLatest, distinctUntilChanged, filter, map, Observable, of, pairwise, startWith, switchMap } from 'rxjs';

/** Label of a kept foundation/project selection once the options loaded without it: the raw id is never shown. */
const KEPT_ID_LABEL = 'Selected';
const NO_ROWS_SUFFIX = '(no rows in range)';

/** Options of the current org and range: `options` is null while they load and after a failed load, `failed` tells the two apart. */
interface OrgTrainingFilterOptionsLoad {
  options: OrgTrainingFilterOptions | null;
  failed: boolean;
}

const OPTIONS_PENDING: OrgTrainingFilterOptionsLoad = { options: null, failed: false };

/**
 * The one filter bar of Training & Certification and People › Trainees: range, foundation, project, course, level and
 * format dropdowns (plus a group-by dropdown when `showGroupBy`). The state lives in the URL: it is read from the query
 * params and every pick is written back (other params such as `tab` are kept). Options load for the current range; a
 * selection they do not list stays applied and visible (never silently dropped, labelled "(no rows in range)"), and
 * Clear all removes it. An organization switch clears the five filters (range and group-by stay), as they were picked
 * from the previous organization's options.
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
  private readonly orgUid: Signal<string> = computed(() => this.accountContext.selectedAccount().uid ?? '');
  /** Re-reads the options of the current org and range (the inline Retry). */
  private readonly optionsRetry$ = new BehaviorSubject<void>(undefined);
  private readonly optionsLoad: Signal<OrgTrainingFilterOptionsLoad> = this.initOptions();
  /** Null until the options of the current org and range loaded (and after a failed load): a kept selection is then not known to be unlisted. */
  private readonly options: Signal<OrgTrainingFilterOptions | null> = computed(() => this.optionsLoad().options);
  /** The options read failed: the dropdowns hold only "All" and the current pick until Retry succeeds. */
  protected readonly optionsFailed: Signal<boolean> = computed(() => this.optionsLoad().failed);

  protected readonly hasFilter: Signal<boolean> = computed(() => hasOrgTrainingFilter(this.state()));
  /** Filters set behind the toggle, so a pick from the URL is never invisible while it is collapsed. */
  protected readonly hiddenFilterCount: Signal<number> = computed(() => ORG_TRAINING_FILTER_KEYS.filter((key) => this.state()[key] !== null).length);
  protected readonly foundationOptions = this.withAll('All Foundations', 'foundations', 'foundation');
  protected readonly projectOptions = this.withAll('All Projects', 'projects', 'project');
  protected readonly courseOptions = this.withAll('All Courses', 'courses', 'course');
  protected readonly levelOptions = this.withAll('All Levels', 'levels', 'level');
  protected readonly formatOptions = this.withAll('All Formats', 'formats', 'format');

  public constructor() {
    // URL → form (silent: only a pick by the user writes to the URL).
    toObservable(this.state)
      .pipe(takeUntilDestroyed())
      .subscribe((state) =>
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
        )
      );

    // An organization switch drops the five filters (not range / group-by): they were picked from the previous organization's options.
    toObservable(this.orgUid)
      .pipe(
        startWith(this.orgUid()),
        distinctUntilChanged(),
        pairwise(),
        filter(([previous, next]) => !!previous && !!next),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        if (this.hasFilter()) this.clearAll();
      });

    // Form → URL.
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.navigate(this.stateFromForm()));
  }

  protected clearAll(): void {
    this.navigate({ ...this.state(), foundation: null, project: null, course: null, level: null, format: null });
  }

  protected retryOptions(): void {
    this.optionsRetry$.next();
  }

  private stateFromForm(): OrgTrainingViewState {
    const value = this.form.getRawValue();
    // The form's control names are the filter keys; the URL params (e.g. `trainingProject`) are the serializer's concern.
    const params: Record<string, string> = {
      [ORG_LENS_TIME_RANGE_QUERY_PARAM]: value.range,
      [ORG_TRAINING_VIEW_QUERY_PARAMS.foundation]: value.foundation,
      [ORG_TRAINING_VIEW_QUERY_PARAMS.project]: value.project,
      [ORG_TRAINING_VIEW_QUERY_PARAMS.course]: value.course,
      [ORG_TRAINING_VIEW_QUERY_PARAMS.level]: value.level,
      [ORG_TRAINING_VIEW_QUERY_PARAMS.format]: value.format,
      [ORG_TRAINING_VIEW_QUERY_PARAMS.groupBy]: value.groupBy,
    };
    return parseOrgTrainingViewState((key) => params[key]);
  }

  /** Writes the state to the URL, leaving every other query param (the page's `tab`, …) alone; `groupBy` only when this bar owns it. */
  private navigate(next: OrgTrainingViewState): void {
    const queryParams = serializeOrgTrainingViewState(next);
    if (!this.showGroupBy()) delete queryParams[ORG_TRAINING_VIEW_QUERY_PARAMS.groupBy];
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge', replaceUrl: true });
  }

  private initOptions(): Signal<OrgTrainingFilterOptionsLoad> {
    const orgUid$ = toObservable(this.orgUid);
    const range$ = toObservable(this.range);
    return toSignal(
      orgUid$.pipe(
        switchMap((orgUid): Observable<OrgTrainingFilterOptionsLoad> => {
          if (!orgUid) return of(OPTIONS_PENDING);
          return combineLatest([range$, this.optionsRetry$]).pipe(
            // Every request (a new org, a new range or a Retry) first drops the previous options, so a pending read is never shown as this range's options.
            switchMap(([range]) =>
              this.trainingService.getFilterOptions(orgUid, range).pipe(
                map((options): OrgTrainingFilterOptionsLoad => ({ options, failed: false })),
                catchError((error: unknown) => {
                  console.error('Failed to load training filter options', error);
                  return of<OrgTrainingFilterOptionsLoad>({ options: null, failed: true });
                }),
                startWith(OPTIONS_PENDING)
              )
            )
          );
        })
      ),
      { initialValue: OPTIONS_PENDING }
    );
  }

  /** "All" first, then the loaded options; a picked value they do not list is kept (applied and visible) under a label that is never a raw id for foundation/project. */
  private withAll(allLabel: string, list: keyof OrgTrainingFilterOptions, key: keyof OrgTrainingFilters): Signal<OrgDropdownOption[]> {
    const idValued = key === 'foundation' || key === 'project';
    return computed(() => {
      const loaded = this.options();
      const options = (loaded ?? EMPTY_ORG_TRAINING_FILTER_OPTIONS)[list];
      const picked = this.state()[key];
      let kept: OrgDropdownOption[] = [];
      if (picked !== null && !options.some((option) => option.value === picked)) {
        const label = idValued ? KEPT_ID_LABEL : picked;
        kept = [{ label: loaded ? `${label} ${NO_ROWS_SUFFIX}` : label, value: picked }];
      }
      return [{ label: allLabel, value: '' }, ...kept, ...options];
    });
  }
}
