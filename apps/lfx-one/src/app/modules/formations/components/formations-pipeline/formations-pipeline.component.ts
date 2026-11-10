// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, linkedSignal, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { FormationService } from '@services/formation.service';
import {
  FORMATION_PIPELINE_COLUMNS,
  FORMATION_PIPELINE_COPY,
  FORMATION_PIPELINE_DEFAULT_SORT,
  FORMATION_PIPELINE_DEFAULT_STAGE,
  FORMATION_PIPELINE_PAGE_SIZE,
  FORMATION_PIPELINE_STAGES,
} from '@lfx-one/shared/constants';
import type {
  FilterPillOption,
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
  buildPipelineStatCards,
  countPipelineRows,
  emptyPipelineCounts,
  filterPipelineRowsByStage,
  getPipelineCsvFilename,
  matchesPipelineSearch,
  sortPipelineRows,
  toPipelineTableRow,
} from '@lfx-one/shared/utils';
import type { TablePageEvent } from 'primeng/table';
import { BehaviorSubject, catchError, combineLatest, debounceTime, distinctUntilChanged, finalize, map, of, startWith, switchMap, tap } from 'rxjs';

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
    SelectComponent,
    StatCardGridComponent,
    TableComponent,
    TagComponent,
  ],
  templateUrl: './formations-pipeline.component.html',
})
export class FormationsPipelineComponent {
  private readonly formationService = inject(FormationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  protected readonly copy = FORMATION_PIPELINE_COPY;
  protected readonly columns = FORMATION_PIPELINE_COLUMNS;
  protected readonly pageSize = FORMATION_PIPELINE_PAGE_SIZE;

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    foundation: new FormControl<string | null>(null),
  });

  private readonly refresh$ = new BehaviorSubject<void>(undefined);
  protected readonly loading = signal(true);
  /** `forbidden` is the BFF's 403 (not on the formation team); `failed` is anything else. */
  protected readonly loadError = signal<'forbidden' | 'failed' | null>(null);
  protected readonly stage = signal<FormationPipelineStageFilter>(FORMATION_PIPELINE_DEFAULT_STAGE);
  protected readonly sort = signal<FormationPipelineSort>(FORMATION_PIPELINE_DEFAULT_SORT);
  private readonly knownFoundations = signal<ReadonlyMap<string, string>>(new Map());

  private readonly searchTerm: Signal<string> = this.initSearchTerm();
  private readonly foundationUid: Signal<string | null> = this.initFoundationUid();
  private readonly response: Signal<FormationPipelineResponse> = this.initResponse();

  /** The foundation's rows narrowed by the name search, client-side: no refetch while the rows are already loaded. */
  private readonly searchedRows = computed(() => this.response().rows.filter((row) => matchesPipelineSearch(row.name, this.searchTerm())));
  /** Stage counts over the searched rows, so the pills and stat cards agree with the table. */
  protected readonly counts = computed(() => countPipelineRows(this.searchedRows()));
  protected readonly isFiltered = computed(() => this.stage() !== FORMATION_PIPELINE_DEFAULT_STAGE || !!this.searchTerm().trim() || !!this.foundationUid());
  protected readonly foundationOptions = computed(() => [
    { label: this.copy.allFoundations, value: null },
    ...[...this.knownFoundations()].map(([value, label]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label)),
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
    this.filterForm.reset({ search: '', foundation: null });
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
        map((value) => value.trim()),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      ),
      { initialValue: '' }
    );
  }

  private initFoundationUid(): Signal<string | null> {
    return toSignal(this.filterForm.controls.foundation.valueChanges.pipe(startWith(null), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef)), {
      initialValue: null,
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
            tap((response) => this.rememberFoundations(response, foundationUid)),
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
