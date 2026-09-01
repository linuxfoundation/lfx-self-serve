// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, effect, input, output, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { FORMATION_QUEUE_SUB_STAGES } from '@lfx-one/shared/constants';
import type { FilterPillOption, Formation, FormationSubStage, TagSeverity } from '@lfx-one/shared/interfaces';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';

const SUB_STAGE_LABEL: Record<FormationSubStage, string> = {
  proposed: 'Proposed',
  exploratory: 'Formation · Exploratory',
  engaged: 'Formation · Engaged',
  on_hold: 'Formation · On Hold',
  activating: 'Activating',
  withdrawn: 'Withdrawn',
};

const SUB_STAGE_SEVERITY: Record<FormationSubStage, TagSeverity> = {
  proposed: 'info',
  exploratory: 'accent',
  engaged: 'accent',
  on_hold: 'accent',
  activating: 'warn',
  withdrawn: 'secondary',
};

export interface FormationsQueueFilterState {
  subStage: FormationSubStage | undefined;
  search: string;
}

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
  public readonly rows = input.required<Formation[]>();
  public readonly loading = input<boolean>(false);

  public readonly filtersChange = output<FormationsQueueFilterState>();
  public readonly accept = output<Formation>();
  public readonly decline = output<Formation>();

  protected readonly statusTab = signal<string>('all');
  protected readonly searchForm = new FormGroup({ search: new FormControl<string>('', { nonNullable: true }) });

  protected readonly statusTabOptions: Signal<FilterPillOption[]> = computed(() => [
    { id: 'all', label: 'All' },
    ...FORMATION_QUEUE_SUB_STAGES.map((stage) => ({ id: stage, label: SUB_STAGE_LABEL[stage] })),
  ]);

  private readonly searchValue = toSignal(
    this.searchForm.controls.search.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      map((value) => value ?? '')
    ),
    { initialValue: '' }
  );

  protected readonly isFiltered = computed(() => this.statusTab() !== 'all' || !!this.searchValue().trim());

  public constructor() {
    // Filtering (both status tab and debounced search) is server-side — the parent re-fetches via
    // filtersChange rather than this component filtering `rows()` itself, since the queue's search
    // param is part of the same API call as the sub_stage filter.
    effect(() => {
      const tab = this.statusTab();
      const search = this.searchValue();
      this.filtersChange.emit({ subStage: tab === 'all' ? undefined : (tab as FormationSubStage), search });
    });
  }

  protected subStageLabel(stage: FormationSubStage): string {
    return SUB_STAGE_LABEL[stage];
  }

  protected subStageSeverity(stage: FormationSubStage): TagSeverity {
    return SUB_STAGE_SEVERITY[stage];
  }

  protected onStatusTabChange(tab: string): void {
    this.statusTab.set(tab);
  }

  protected onAccept(row: Formation): void {
    this.accept.emit(row);
  }

  protected onDecline(row: Formation): void {
    this.decline.emit(row);
  }
}
