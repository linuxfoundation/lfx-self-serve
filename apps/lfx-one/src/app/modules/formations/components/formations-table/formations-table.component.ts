// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { FORMATION_QUEUE_SUB_STAGES, FORMATION_SUB_STAGE_LABELS, FORMATION_SUB_STAGE_SEVERITY } from '@lfx-one/shared/constants';
import type { FilterPillOption, Formation, FormationsQueueFilterState, FormationSubStage, FormationTableRow } from '@lfx-one/shared/interfaces';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';

@Component({
  selector: 'lfx-formations-table',
  imports: [
    ReactiveFormsModule,
    CardComponent,
    CardTabsBarComponent,
    InputTextComponent,
    TableComponent,
    TagComponent,
    ButtonComponent,
    EmptyStateComponent,
    DatePipe,
  ],
  templateUrl: './formations-table.component.html',
  styleUrl: './formations-table.component.scss',
})
export class FormationsTableComponent {
  private readonly destroyRef = inject(DestroyRef);

  public readonly rows = input.required<Formation[]>();
  public readonly loading = input<boolean>(false);

  public readonly filtersChange = output<FormationsQueueFilterState>();
  public readonly accept = output<Formation>();
  public readonly decline = output<Formation>();

  protected readonly searchForm = new FormGroup({ search: new FormControl<string>('', { nonNullable: true }) });

  protected readonly statusTab = signal<string>('all');
  private readonly searchValue = signal('');

  protected readonly statusTabOptions: Signal<FilterPillOption[]> = computed(() => [
    { id: 'all', label: 'All' },
    ...FORMATION_QUEUE_SUB_STAGES.map((stage) => ({ id: stage, label: FORMATION_SUB_STAGE_LABELS[stage] })),
  ]);

  protected readonly isFiltered = computed(() => this.statusTab() !== 'all' || !!this.searchValue().trim());
  protected readonly displayRows: Signal<FormationTableRow[]> = this.initDisplayRows();

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

  protected onAccept(row: Formation): void {
    this.accept.emit(row);
  }

  protected onDecline(row: Formation): void {
    this.decline.emit(row);
  }

  /** PrimeNG types the `#body` row context `any` — precomputing the chip label/severity here lets the template do a plain property read instead of a method call. */
  private initDisplayRows(): Signal<FormationTableRow[]> {
    return computed(() =>
      this.rows().map((row) => ({ ...row, stageLabel: FORMATION_SUB_STAGE_LABELS[row.sub_stage], stageSeverity: FORMATION_SUB_STAGE_SEVERITY[row.sub_stage] }))
    );
  }

  private emitFilters(): void {
    const tab = this.statusTab();
    this.filtersChange.emit({ subStage: tab === 'all' ? undefined : (tab as FormationSubStage), search: this.searchValue() });
  }
}
