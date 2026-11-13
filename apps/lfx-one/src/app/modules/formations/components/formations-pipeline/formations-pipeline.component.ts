// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, linkedSignal, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { SelectComponent } from '@components/select/select.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { FormationService } from '@services/formation.service';
import {
  FORMATION_PIPELINE_CLASSIFICATION_FILTER_PLACEHOLDERS,
  FORMATION_PIPELINE_CLASSIFICATION_KEYS,
  FORMATION_PIPELINE_CLASSIFICATION_PANEL_CLASSES,
  FORMATION_PIPELINE_CLASSIFICATION_LABELS,
  FORMATION_PIPELINE_COLUMNS,
  FORMATION_PIPELINE_COPY,
  FORMATION_PIPELINE_DEFAULT_FOUNDATION_KIND,
  FORMATION_PIPELINE_DEFAULT_STAGE,
  FORMATION_PIPELINE_FOUNDATION_KIND_LABELS,
  FORMATION_PIPELINE_FOUNDATION_KINDS,
  FORMATION_PIPELINE_PAGE_SIZE,
  FORMATION_PIPELINE_SEARCH_MAX_LENGTH,
  FORMATION_PIPELINE_STAGES,
} from '@lfx-one/shared/constants';
import type {
  FilterPillOption,
  FormationPipelineClassificationKey,
  FormationPipelineClassificationSelection,
  FormationPipelineFoundationKindFilter,
  FormationPipelineResponse,
  FormationPipelineSort,
  FormationPipelineSortKey,
  FormationPipelineStageFilter,
  FormationPipelineTableRow,
  StatCardItem,
} from '@lfx-one/shared/interfaces';
import {
  buildPipelineCsvRows,
  downloadCsv,
  buildPipelinePillOptions,
  buildPipelineUrlParams,
  buildPipelineStatCards,
  comparePipelineText,
  countPipelineRows,
  emptyPipelineCounts,
  emptyPipelineClassification,
  filterPipelineRowsByClassification,
  filterPipelineRowsByFoundationKind,
  getPipelineClassificationOptions,
  hasPipelineClassificationFilter,
  pruneUnknownPipelineClassification,
  filterPipelineRowsByStage,
  getPipelineCsvFilename,
  parsePipelineUrlState,
  matchesPipelineSearch,
  normalizePipelineSearch,
  sortPipelineRows,
  toPipelineTableRow,
} from '@lfx-one/shared/utils';
import type { TablePageEvent } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  finalize,
  map,
  of,
  skip,
  startWith,
  switchMap,
  tap,
} from 'rxjs';

/**
 * The Pipeline tab of the LF-root Formations page (#5475): every non-Active project by stage for the formation team,
 * with stage stat cards and pills, a foundation filter, name search, sortable columns and a CSV export. The stage
 * selection, name search, sort and pagination are client-side over the one response; only the foundation goes to the
 * BFF (a change switches to the new read, cancelling any one in flight).
 */
@Component({
  selector: 'lfx-formations-pipeline',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    FilterPillsComponent,
    InputTextComponent,
    MultiSelectComponent,
    SelectComponent,
    StatCardGridComponent,
    TableComponent,
    TagComponent,
    TooltipModule,
  ],
  templateUrl: './formations-pipeline.component.html',
})
export class FormationsPipelineComponent {
  private readonly formationService = inject(FormationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly copy = FORMATION_PIPELINE_COPY;
  protected readonly columns = FORMATION_PIPELINE_COLUMNS;
  protected readonly pageSize = FORMATION_PIPELINE_PAGE_SIZE;
  protected readonly searchMaxLength = FORMATION_PIPELINE_SEARCH_MAX_LENGTH;

  /** The filter and sort state the page opened with, read from the URL once: a shared or reloaded link reopens the same view (#5619). Unknown values fall back to the defaults. */
  private readonly initialState = parsePipelineUrlState(this.route.snapshot.queryParamMap);

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>(this.initialState.search, { nonNullable: true }),
    foundation: new FormControl<string | null>(this.initialState.foundationUid),
    foundationKind: new FormControl<FormationPipelineFoundationKindFilter>(this.initialState.foundationKind, { nonNullable: true }),
    technical_activity_type: new FormControl<string[]>(this.initialState.classification.technical_activity_type, { nonNullable: true }),
    technology: new FormControl<string[]>(this.initialState.classification.technology, { nonNullable: true }),
    industry: new FormControl<string[]>(this.initialState.classification.industry, { nonNullable: true }),
  });
  protected readonly classificationKeys = FORMATION_PIPELINE_CLASSIFICATION_KEYS;
  protected readonly classificationLabels = FORMATION_PIPELINE_CLASSIFICATION_LABELS;
  protected readonly classificationPlaceholders = FORMATION_PIPELINE_CLASSIFICATION_FILTER_PLACEHOLDERS;
  protected readonly classificationPanelClasses = FORMATION_PIPELINE_CLASSIFICATION_PANEL_CLASSES;

  private readonly refresh$ = new BehaviorSubject<void>(undefined);
  protected readonly loading = signal(true);
  /** `forbidden` is the BFF's 403 (not on the formation team); `failed` is anything else. */
  protected readonly loadError = signal<'forbidden' | 'failed' | null>(null);
  protected readonly stage = signal<FormationPipelineStageFilter>(this.initialState.stage);
  protected readonly sort = signal<FormationPipelineSort>(this.initialState.sort);
  private readonly knownFoundations = signal<ReadonlyMap<string, string>>(new Map());
  /** Declared before `response`, whose first read can already consult it. */
  private foundationsRequested = false;
  /** A link may name classification values this data does not have; they are dropped once, against the first rows that load. */
  private classificationChecked = false;

  private readonly searchTerm: Signal<string> = this.initSearchTerm();
  private readonly foundationUid: Signal<string | null> = this.initFoundationUid();
  private readonly foundationKind: Signal<FormationPipelineFoundationKindFilter> = this.initFoundationKind();
  /** The three classification multi-selects' values (#5619 Part C). */
  private readonly classification: Signal<FormationPipelineClassificationSelection> = this.initClassification();
  private readonly response: Signal<FormationPipelineResponse> = this.initResponse();

  /** The query params for the current filters and sort; the search is the debounced term. */
  private readonly urlParams = computed(() =>
    buildPipelineUrlParams({
      stage: this.stage(),
      foundationUid: this.foundationUid(),
      foundationKind: this.foundationKind(),
      search: this.searchTerm(),
      classification: this.classification(),
      sort: this.sort(),
    })
  );

  /** The foundation's rows narrowed by the foundation type and the name search, client-side: no refetch while the rows are already loaded. */
  private readonly kindAndSearchRows = computed(() =>
    filterPipelineRowsByFoundationKind(this.response().rows, this.foundationKind()).filter((row) => matchesPipelineSearch(row.name, this.searchTerm()))
  );
  /** Those rows narrowed by the classification filters too; the counts, pills, stat cards, table and CSV all read from here (#5619 Part C). */
  private readonly searchedRows = computed(() => filterPipelineRowsByClassification(this.kindAndSearchRows(), this.classification()));
  /**
   * The options of each classification select: the values present in the rows after every OTHER filter (stage, foundation type,
   * search and the other two classification filters), each with its count. A selected value the other filters have emptied stays
   * listed with a zero count, so it can still be seen and cleared.
   */
  protected readonly classificationOptions = computed<Record<FormationPipelineClassificationKey, { label: string; value: string }[]>>(() => {
    const selection = this.classification();
    const staged = filterPipelineRowsByStage(this.kindAndSearchRows(), this.stage());
    const entries = FORMATION_PIPELINE_CLASSIFICATION_KEYS.map((key) => {
      const present = getPipelineClassificationOptions(filterPipelineRowsByClassification(staged, selection, key), key);
      const listed = new Set(present.map((option) => option.value));
      const kept = selection[key].filter((value) => !listed.has(value)).map((value) => ({ value, count: 0 }));
      const options = [...present, ...kept].sort((a, b) => comparePipelineText(a.value, b.value));
      return [key, options.map((option) => ({ label: `${option.value} (${option.count})`, value: option.value }))] as const;
    });
    return Object.fromEntries(entries) as Record<FormationPipelineClassificationKey, { label: string; value: string }[]>;
  });
  /** Stage counts over the searched rows, so the pills and stat cards agree with the table. */
  protected readonly counts = computed(() => countPipelineRows(this.searchedRows()));
  protected readonly isFiltered = computed(
    () =>
      this.stage() !== FORMATION_PIPELINE_DEFAULT_STAGE ||
      !!this.searchTerm().trim() ||
      !!this.foundationUid() ||
      this.foundationKind() !== FORMATION_PIPELINE_DEFAULT_FOUNDATION_KIND ||
      hasPipelineClassificationFilter(this.classification())
  );
  protected readonly foundationKindOptions = computed(() => [
    { label: this.copy.allFoundationKinds, value: FORMATION_PIPELINE_DEFAULT_FOUNDATION_KIND },
    ...FORMATION_PIPELINE_FOUNDATION_KINDS.map((value) => ({ label: FORMATION_PIPELINE_FOUNDATION_KIND_LABELS[value], value })),
  ]);
  protected readonly foundationOptions = computed(() => [
    { label: this.copy.allFoundations, value: null },
    ...[...this.knownFoundations()].map(([value, label]) => ({ label, value })).sort((a, b) => comparePipelineText(a.label, b.label)),
  ]);
  protected readonly pillOptions: Signal<FilterPillOption[]> = computed(() => buildPipelinePillOptions(this.counts()));
  protected readonly statCards: Signal<StatCardItem[]> = computed(() => buildPipelineStatCards(this.counts(), this.searchedRows(), this.stage()));
  protected readonly displayRows: Signal<FormationPipelineTableRow[]> = computed(() => {
    const now = new Date();
    return sortPipelineRows(filterPipelineRowsByStage(this.searchedRows(), this.stage()), this.sort()).map((row) => toPipelineTableRow(row, now));
  });
  /** Paginator offset; any change to the displayed list returns to page one. */
  protected readonly first = linkedSignal({ source: this.displayRows, computation: () => 0 });
  /** Cards shown on the phone list; "Load more" adds a page. */
  protected readonly mobileCount = linkedSignal({ source: this.displayRows, computation: () => FORMATION_PIPELINE_PAGE_SIZE });
  protected readonly mobileRows = computed(() => this.displayRows().slice(0, this.mobileCount()));

  protected readonly ariaSort = computed<Record<FormationPipelineSortKey, 'ascending' | 'descending' | 'none'>>(() => {
    const { key, direction } = this.sort();
    const state = direction === 'asc' ? 'ascending' : 'descending';
    return Object.fromEntries(this.columns.map((column) => [column.key, column.key === key ? state : 'none'])) as Record<
      FormationPipelineSortKey,
      'ascending' | 'descending' | 'none'
    >;
  });
  protected readonly sortIcon = computed<Record<FormationPipelineSortKey, string>>(() => {
    const { key, direction } = this.sort();
    const active = direction === 'asc' ? 'fa-solid fa-caret-up text-blue-500' : 'fa-solid fa-caret-down text-blue-500';
    return Object.fromEntries(this.columns.map((column) => [column.key, column.key === key ? active : 'fa-light fa-sort text-gray-300'])) as Record<
      FormationPipelineSortKey,
      string
    >;
  });

  public constructor() {
    this.initUrlSync();
  }

  protected onStageChange(stage: string): void {
    this.stage.set(this.toStageFilter(stage));
  }

  /** A stat card filters to its stage; selecting the active card again returns to the default view. */
  protected onStatAction(action: string): void {
    const next = this.toStageFilter(action);
    this.stage.set(this.stage() === next ? FORMATION_PIPELINE_DEFAULT_STAGE : next);
  }

  protected onHeaderClick(key: FormationPipelineSortKey): void {
    const current = this.sort();
    this.sort.set({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' });
  }

  protected onPage(event: TablePageEvent): void {
    this.first.set(event.first);
  }

  protected loadMore(): void {
    this.mobileCount.update((count) => count + FORMATION_PIPELINE_PAGE_SIZE);
  }

  protected onRowSelect(event: { data: FormationPipelineTableRow }): void {
    const { commands, queryParams } = event.data.link;
    this.router.navigate(commands, queryParams ? { queryParams } : { queryParamsHandling: 'preserve' });
  }

  protected resetFilters(): void {
    this.filterForm.reset({ search: '', foundation: null, foundationKind: FORMATION_PIPELINE_DEFAULT_FOUNDATION_KIND, ...emptyPipelineClassification() });
    this.stage.set(FORMATION_PIPELINE_DEFAULT_STAGE);
  }

  protected onRetry(): void {
    this.refresh$.next();
  }

  /** Downloads the filtered rows (every page) as CSV. `downloadCsv` is browser-only and a no-op on the server. */
  protected exportCsv(): void {
    downloadCsv(getPipelineCsvFilename(), buildPipelineCsvRows(this.displayRows()));
  }

  /** A pill or card id as a stage selection; anything unrecognized is the default view. */
  private toStageFilter(id: string): FormationPipelineStageFilter {
    if (id === 'all') {
      return 'all';
    }
    return FORMATION_PIPELINE_STAGES.find((candidate) => candidate === id) ?? FORMATION_PIPELINE_DEFAULT_STAGE;
  }

  private initSearchTerm(): Signal<string> {
    return toSignal(
      this.filterForm.controls.search.valueChanges.pipe(
        debounceTime(300),
        map((value) => normalizePipelineSearch(value)),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      ),
      { initialValue: this.initialState.search }
    );
  }

  private initFoundationUid(): Signal<string | null> {
    return toSignal(
      this.filterForm.controls.foundation.valueChanges.pipe(
        startWith(this.initialState.foundationUid),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      ),
      { initialValue: this.initialState.foundationUid }
    );
  }

  /**
   * Keeps the URL in step with the filters and sort (#5619): `replaceUrl`, so filtering does not fill the history; `merge`, so `tab` and
   * `project` stay. Seeded with the params of the state this page was opened with, so reading the URL never writes it back.
   */
  private initUrlSync(): void {
    toObservable(this.urlParams)
      .pipe(
        startWith(buildPipelineUrlParams(this.initialState)),
        distinctUntilChanged((previous, next) => JSON.stringify(previous) === JSON.stringify(next)),
        skip(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((queryParams) => this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge', replaceUrl: true }));
  }

  private initClassification(): Signal<FormationPipelineClassificationSelection> {
    const read = (): FormationPipelineClassificationSelection => ({
      technical_activity_type: this.filterForm.controls.technical_activity_type.value,
      technology: this.filterForm.controls.technology.value,
      industry: this.filterForm.controls.industry.value,
    });
    return toSignal(
      this.filterForm.valueChanges.pipe(
        map(read),
        distinctUntilChanged((previous, next) => JSON.stringify(previous) === JSON.stringify(next)),
        takeUntilDestroyed(this.destroyRef)
      ),
      { initialValue: this.initialState.classification }
    );
  }

  private initFoundationKind(): Signal<FormationPipelineFoundationKindFilter> {
    return toSignal(this.filterForm.controls.foundationKind.valueChanges.pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef)), {
      initialValue: this.initialState.foundationKind,
    });
  }

  private initResponse(): Signal<FormationPipelineResponse> {
    const empty: FormationPipelineResponse = { rows: [], counts: emptyPipelineCounts() };
    return toSignal(
      combineLatest([this.refresh$, toObservable(this.foundationUid)]).pipe(
        switchMap(([, foundationUid]) => {
          this.loadError.set(null);
          this.loading.set(true);
          return this.formationService.getFormationPipeline(foundationUid).pipe(
            tap((response) => {
              this.pruneUnknownClassification(response);
              this.rememberFoundations(response, foundationUid);
              this.loadFoundationOptionsForDeepLink(foundationUid);
            }),
            catchError((error: unknown) => {
              console.error('[FormationsPipeline] Failed to load the pipeline', error);
              this.loadError.set(error instanceof HttpErrorResponse && error.status === 403 ? 'forbidden' : 'failed');
              return of(empty);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: empty }
    );
  }

  /** Drops link-borne classification values that no loaded row holds, once, so a stale or hand-edited link opens a sane view. */
  private pruneUnknownClassification(response: FormationPipelineResponse): void {
    if (this.classificationChecked) {
      return;
    }
    this.classificationChecked = true;
    const current = this.classification();
    const pruned = pruneUnknownPipelineClassification(current, response.rows);
    for (const key of FORMATION_PIPELINE_CLASSIFICATION_KEYS) {
      if (pruned[key].length !== current[key].length) {
        this.filterForm.controls[key].setValue(pruned[key]);
      }
    }
  }

  /** A link that opens already scoped to a foundation has no unfiltered read to list the foundations from, so the select would show no label: read it in the background. A failed read is logged and retried with the next successful read. */
  private loadFoundationOptionsForDeepLink(foundationUid: string | null): void {
    if (!foundationUid || this.foundationsRequested || this.knownFoundations().size > 0) {
      return;
    }
    this.foundationsRequested = true;
    this.formationService
      .getFormationPipeline(null)
      .pipe(
        catchError((error: unknown) => {
          // Let the next successful read try again, rather than leave the select unlabeled for good.
          console.error('[FormationsPipeline] Failed to load the foundation options', error);
          this.foundationsRequested = false;
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response) => this.rememberFoundations(response, null));
  }

  /** The foundation options come from the unfiltered read; a foundation-scoped read would shrink the list to itself. */
  private rememberFoundations(response: FormationPipelineResponse, foundationUid: string | null): void {
    if (foundationUid) {
      return;
    }
    const next = new Map<string, string>();
    for (const row of response.rows) {
      if (row.parent?.name) {
        next.set(row.parent.uid, row.parent.name);
      }
    }
    this.knownFoundations.set(next);
  }
}
