// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { FORMATION_ENTITY_TYPE_LABELS, FORMATION_QUEUE_SUB_STAGES, FORMATION_SUB_STAGE_LABELS, FORMATION_SUB_STAGE_SEVERITY } from '@lfx-one/shared/constants';
import type { FilterPillOption, FormationQueueRow, FormationsQueueFilterState, FormationSubStage, FormationTableRow } from '@lfx-one/shared/interfaces';
import { deriveFormationEntityType } from '@lfx-one/shared/utils';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';

/** Column-local sort aria state — mirrors `meetups-table.component.ts`'s `MeetupSortAria` pattern; not a shared domain type since sorting here is purely client-side (no server sort param). */
type FormationSortAria = 'ascending' | 'descending' | 'none';
/** The two GH-1958 sortable columns — "Progress"/readiness and "Announcement". */
type FormationSortableField = 'readiness' | 'announcement_date';

@Component({
  selector: 'lfx-formations-table',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    CardComponent,
    CardTabsBarComponent,
    InputTextComponent,
    TableComponent,
    TagComponent,
    EmptyStateComponent,
    DatePipe,
  ],
  templateUrl: './formations-table.component.html',
  styleUrl: './formations-table.component.scss',
})
export class FormationsTableComponent {
  private readonly destroyRef = inject(DestroyRef);

  public readonly rows = input.required<FormationQueueRow[]>();
  public readonly loading = input<boolean>(false);

  public readonly filtersChange = output<FormationsQueueFilterState>();

  protected readonly searchForm = new FormGroup({ search: new FormControl<string>('', { nonNullable: true }) });

  protected readonly statusTab = signal<string>('all');
  private readonly searchValue = signal('');
  // Defaults to announcement date so the queue opens with its most actionable column sorted —
  // rows with no announcement date set (comparator below) always sort last regardless of direction.
  protected readonly sortField = signal<FormationSortableField | null>('announcement_date');
  protected readonly sortOrder = signal<'ASC' | 'DESC'>('ASC');

  protected readonly statusTabOptions: Signal<FilterPillOption[]> = computed(() => [
    { id: 'all', label: 'All' },
    ...FORMATION_QUEUE_SUB_STAGES.map((stage) => ({ id: stage, label: FORMATION_SUB_STAGE_LABELS[stage] })),
  ]);

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
    // Search is debounced and only re-emits filtersChange from here — the status-tab tab click
    // emits directly from onStatusTabChange. Filtering (both) is server-side: the parent re-fetches
    // via filtersChange rather than this component filtering rows() itself.
    this.searchForm.controls.search.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        map((value) => value ?? ''),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((search) => {
        this.searchValue.set(search);
        this.emitFilters();
      });
  }

  protected onStatusTabChange(tab: string): void {
    this.statusTab.set(tab);
    this.emitFilters();
  }

  /** Sorting is entirely client-side (no server sort param — `rows()` already holds every filtered row), so a repeat click on the active column toggles direction instead of round-tripping. */
  protected onHeaderClick(field: FormationSortableField): void {
    if (this.sortField() === field) {
      this.sortOrder.set(this.sortOrder() === 'ASC' ? 'DESC' : 'ASC');
    } else {
      this.sortField.set(field);
      this.sortOrder.set('ASC');
    }
  }

  /**
   * PrimeNG types the `#body` row context `any` — precomputing the chip label/severity and sort
   * order here lets the template do a plain property read instead of a method call.
   * `doneCount`/`totalCount` sum {@link FormationQueueRow.progress} once per row rather than in the
   * template (GH-2267 gap 2 — the queue projection has no precomputed gating open/total pair).
   */
  private initDisplayRows(): Signal<FormationTableRow[]> {
    return computed(() => {
      const rows = this.rows();
      const displayRows = rows.map((row) => ({
        ...row,
        stageLabel: FORMATION_SUB_STAGE_LABELS[row.sub_stage],
        stageSeverity: FORMATION_SUB_STAGE_SEVERITY[row.sub_stage],
        entityTypeLabel: FORMATION_ENTITY_TYPE_LABELS[deriveFormationEntityType(row)],
        doneCount: row.progress['done'] ?? 0,
        totalCount: Object.values(row.progress).reduce((sum, count) => sum + count, 0),
      }));
      return this.sortDisplayRows(displayRows);
    });
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
