// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, linkedSignal, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  FORMATION_ANNOUNCEMENT_NEEDED_LABEL,
  FORMATION_ANNOUNCEMENT_TIMING_CLASS,
  FORMATION_EMPTY_QUEUE_TILES,
  FORMATION_ENTITY_TYPE_LABELS,
  FORMATION_QUEUE_PAGE_SIZE,
  FORMATION_QUEUE_PAGE_SIZE_OPTIONS,
  FORMATION_QUEUE_SUB_STAGES,
  FORMATION_SUB_STAGE_LABELS,
} from '@lfx-one/shared/constants';
import type {
  FilterPillOption,
  FormationQueueRow,
  FormationQueueTiles,
  FormationsQueueFilterState,
  FormationSubStage,
  FormationTableRow,
} from '@lfx-one/shared/interfaces';
import {
  buildFormationProgressSegments,
  deriveFormationEntityType,
  formatAnnouncementDateLabel,
  formatFormationAnnouncementCountdown,
  formatFormationProgressSummary,
  getFormationAnnouncementTiming,
  getFormationQueueStageDisplay,
  sumFormationProgress,
} from '@lfx-one/shared/utils';
import type { TablePageEvent } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { debounceTime, map } from 'rxjs';

/** Column-local sort aria state — mirrors `meetups-table.component.ts`'s `MeetupSortAria` pattern; not a shared domain type since sorting here is purely client-side (no server sort param). */
type FormationSortAria = 'ascending' | 'descending' | 'none';
/** The two GH-1958 sortable columns — "Progress"/readiness and "Announcement". */
type FormationSortableField = 'readiness' | 'announcement_date';

@Component({
  selector: 'lfx-formations-table',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TooltipModule,
    CardComponent,
    CardTabsBarComponent,
    InputTextComponent,
    TableComponent,
    TagComponent,
    EmptyStateComponent,
  ],
  templateUrl: './formations-table.component.html',
  styleUrl: './formations-table.component.scss',
})
export class FormationsTableComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  public readonly rows = input.required<FormationQueueRow[]>();
  /** The server's pre-filter counts — the pill labels read their "(N)" off these, never off `rows`, which the active pill has already narrowed. */
  public readonly tiles = input<FormationQueueTiles>(FORMATION_EMPTY_QUEUE_TILES);
  public readonly loading = input<boolean>(false);

  public readonly filtersChange = output<FormationsQueueFilterState>();

  protected readonly searchForm = new FormGroup({ search: new FormControl<string>('', { nonNullable: true }) });

  protected readonly statusTab = signal<string>('all');
  private readonly searchValue = signal('');
  // Defaults to announcement date so the queue opens with its most actionable column sorted —
  // rows with no announcement date set (comparator below) always sort last regardless of direction,
  // which puts the most overdue announcement first.
  protected readonly sortField = signal<FormationSortableField | null>('announcement_date');
  protected readonly sortOrder = signal<'ASC' | 'DESC'>('ASC');
  /**
   * Paginator offset. Linked to `rows` so any replacement of the list — a foundation switch
   * refetches without recreating this component — lands on the first page, and reset explicitly by
   * the filter, sort and reset paths below. PrimeNG only self-corrects by one page: its
   * `updateFirst()` runs on a `totalRecords` change and no-ops when the old page is still past the
   * new page count, so a 120-row queue left on page 5 would render a 30-row queue as an empty body.
   */
  protected readonly first = linkedSignal({ source: this.rows, computation: () => 0 });

  protected readonly pageSize = FORMATION_QUEUE_PAGE_SIZE;
  protected readonly pageSizeOptions = FORMATION_QUEUE_PAGE_SIZE_OPTIONS;

  protected readonly statusTabOptions: Signal<FilterPillOption[]> = this.initStatusTabOptions();
  protected readonly isFiltered = computed(() => this.statusTab() !== 'all' || !!this.searchValue().trim());
  protected readonly displayRows: Signal<FormationTableRow[]> = this.initDisplayRows();

  protected readonly ariaSortMap = computed<Record<FormationSortableField, FormationSortAria>>(() => {
    const field = this.sortField();
    const order = this.sortOrder();
    const getAriaSort = (f: FormationSortableField): FormationSortAria => {
      if (field !== f) return 'none';
      return order === 'ASC' ? 'ascending' : 'descending';
    };
    return { readiness: getAriaSort('readiness'), announcement_date: getAriaSort('announcement_date') };
  });

  protected readonly sortIcons = computed(() => {
    const field = this.sortField();
    const order = this.sortOrder();
    const getIcon = (f: FormationSortableField): string => {
      if (field !== f) return 'fa-light fa-sort text-gray-300';
      return order === 'ASC' ? 'fa-solid fa-caret-up text-blue-500' : 'fa-solid fa-caret-down text-blue-500';
    };
    return { readiness: getIcon('readiness'), announcement_date: getIcon('announcement_date') };
  });

  public constructor() {
    // Search is debounced and only re-emits filtersChange from here — the status-tab click emits
    // directly from onStatusTabChange. Filtering (both) is server-side: the parent re-fetches via
    // filtersChange rather than this component filtering rows() itself.
    //
    // No `distinctUntilChanged`: its memory would outlive `resetFilters()`, so a term typed again
    // right after "Reset filters" (inside the debounce window) would be swallowed. The equality
    // guard below does the same de-duplication against the value actually applied — which also
    // stops the form reset's own delayed '' from firing a second identical fetch.
    this.searchForm.controls.search.valueChanges
      .pipe(
        debounceTime(300),
        map((value) => value ?? ''),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((search) => {
        if (search === this.searchValue()) return;
        this.first.set(0);
        this.searchValue.set(search);
        this.emitFilters();
      });
  }

  protected onStatusTabChange(tab: string): void {
    this.first.set(0);
    this.statusTab.set(tab);
    this.emitFilters();
  }

  protected onPage(event: TablePageEvent): void {
    this.first.set(event.first);
  }

  /**
   * Whole-row click (mouse) opens the same drill-down the name link does, with the same
   * `queryParamsHandling: 'preserve'` (LFXV2-3386): the child rides the path param and `?project=`
   * keeps naming the foundation. The name link stays the keyboard path — `lfx-table`'s row select
   * is a host click handler, not a focusable row.
   */
  protected onRowSelect(event: { data: FormationTableRow }): void {
    this.router.navigate(['/foundation/formations', event.data.project_slug], { queryParamsHandling: 'preserve' });
  }

  /** Sorting is entirely client-side (no server sort param — `rows()` already holds every filtered row), so a repeat click on the active column toggles direction instead of round-tripping. */
  protected onHeaderClick(field: FormationSortableField): void {
    // A re-sorted list starts from page one (PrimeNG's own `resetPageOnSort` default) — page N of
    // the old order says nothing about page N of the new one.
    this.first.set(0);
    if (this.sortField() === field) {
      this.sortOrder.set(this.sortOrder() === 'ASC' ? 'DESC' : 'ASC');
    } else {
      this.sortField.set(field);
      this.sortOrder.set('ASC');
    }
  }

  // `searchValue` is set directly so the reset re-fetches now rather than after the debounce; the
  // form reset still emits so the debounced pipeline and the control agree on the empty value (its
  // delayed '' then matches `searchValue` and is dropped by the constructor's guard).
  protected resetFilters(): void {
    this.searchForm.reset({ search: '' });
    this.first.set(0);
    this.statusTab.set('all');
    this.searchValue.set('');
    this.emitFilters();
  }

  /**
   * The stage pills with their server-side counts — "All (3)", "Engaged (2)" — built from the same
   * `FORMATION_QUEUE_SUB_STAGES`/`FORMATION_SUB_STAGE_LABELS` pair `FORMATION_STAGE_TAB_OPTIONS`
   * derives from, so a new sub-stage still lands here and on My Formations together. Counts are
   * withheld only while the very first fetch is in flight (empty tiles + loading): a refetch on a
   * pill change keeps the previous tiles, which don't move with the filter, so the labels hold still.
   */
  private initStatusTabOptions(): Signal<FilterPillOption[]> {
    return computed(() => {
      const tiles = this.tiles();
      const showCounts = !this.loading() || tiles.total > 0;
      const withCount = (id: string, label: string, count: number): FilterPillOption => {
        if (!showCounts) return { id, label };
        return { id, label: `${label} (${count})`, fullLabel: `${label} — ${count} ${count === 1 ? 'formation' : 'formations'}` };
      };
      return [
        withCount('all', 'All', tiles.total),
        ...FORMATION_QUEUE_SUB_STAGES.map((stage) => withCount(stage, FORMATION_SUB_STAGE_LABELS[stage], tiles[stage])),
      ];
    });
  }

  /**
   * PrimeNG types the `#body` row context `any` — precomputing every display field here lets the
   * template do plain property reads instead of method calls. `doneCount`/`totalCount` sum
   * {@link FormationQueueRow.progress} once per row (GH-2267 gap 2 — the queue projection has no
   * precomputed gating open/total pair).
   */
  private initDisplayRows(): Signal<FormationTableRow[]> {
    return computed(() => {
      const displayRows = this.rows().map((row) => this.toDisplayRow(row));
      return this.sortDisplayRows(displayRows);
    });
  }

  private toDisplayRow(row: FormationQueueRow): FormationTableRow {
    const stageDisplay = getFormationQueueStageDisplay(row.sub_stage, row.sub_stage_raw);
    const announcementTiming = getFormationAnnouncementTiming(row.announcement_date, row.gates_cleared);
    const blockedCount = row.blocked_item_titles.length;
    return {
      ...row,
      stageLabel: stageDisplay.label,
      stageSeverity: stageDisplay.severity,
      entityTypeLabel: FORMATION_ENTITY_TYPE_LABELS[deriveFormationEntityType(row)],
      announcementLabel: formatAnnouncementDateLabel(row.announcement_date),
      announcementLabelClass: announcementTiming === 'unset' ? FORMATION_ANNOUNCEMENT_TIMING_CLASS.unset : 'text-gray-700',
      announcementTiming,
      announcementDetail: announcementTiming === 'needed' ? FORMATION_ANNOUNCEMENT_NEEDED_LABEL : formatFormationAnnouncementCountdown(row.announcement_date),
      announcementDetailClass: FORMATION_ANNOUNCEMENT_TIMING_CLASS[announcementTiming],
      // A skipped item is resolved, not remaining work — folded into doneCount so a formation
      // whose only open items are skipped renders (and sorts) as complete, not as permanently
      // incomplete. totalCount deliberately stays every status bucket.
      doneCount: (row.progress['done'] ?? 0) + (row.progress['skipped'] ?? 0),
      totalCount: sumFormationProgress(row.progress),
      progressSegments: buildFormationProgressSegments(row.progress),
      progressSummary: formatFormationProgressSummary(row.progress),
      blockedCount,
      blockedLabel: blockedCount > 0 ? `${blockedCount} blocked` : '',
      blockedTitlesLabel: row.blocked_item_titles.join(' · '),
      firstBlockedTitle: row.blocked_item_titles[0] ?? null,
    };
  }

  private sortDisplayRows(rows: FormationTableRow[]): FormationTableRow[] {
    const field = this.sortField();
    if (!field) return rows;
    const direction = this.sortOrder() === 'ASC' ? 1 : -1;
    const getSortValue = (row: FormationTableRow): number | null => {
      if (field === 'readiness') return row.totalCount - row.doneCount;
      return row.announcement_date ? new Date(row.announcement_date).getTime() : null;
    };
    // Nulls (no announcement date set) always sort last, regardless of direction.
    return [...rows].sort((a, b) => {
      const valueA = getSortValue(a);
      const valueB = getSortValue(b);
      if (valueA === null && valueB === null) return 0;
      if (valueA === null) return 1;
      if (valueB === null) return -1;
      return (valueA - valueB) * direction;
    });
  }

  private emitFilters(): void {
    const tab = this.statusTab();
    this.filtersChange.emit({ subStage: tab === 'all' ? undefined : (tab as FormationSubStage), search: this.searchValue() });
  }
}
