// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { switchMap, startWith } from 'rxjs';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { Committee, COMMITTEE_LABEL } from '@lfx-one/shared';
import { FilterPillOption } from '@lfx-one/shared/interfaces';
import { PlatformIconPipe } from '@app/shared/pipes/platform-icon.pipe';
import { PlatformLabelPipe } from '@app/shared/pipes/platform-label.pipe';
import { PersonaService } from '@services/persona.service';

import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-committee-table',
  imports: [
    DatePipe,
    DecimalPipe,
    ReactiveFormsModule,
    RouterLink,
    CardComponent,
    CardTabsBarComponent,
    ButtonComponent,
    TableComponent,
    TagComponent,
    InputTextComponent,
    SelectComponent,
    TooltipModule,
    PlatformIconPipe,
    PlatformLabelPipe,
    EmptyStateComponent,
  ],
  templateUrl: './committee-table.component.html',
  styleUrl: './committee-table.component.scss',
})
export class CommitteeTableComponent {
  // Injected services
  private readonly personaService = inject(PersonaService);

  // Inputs
  public committees = input.required<Committee[]>();
  public hasItems = input<boolean>(true);
  public canManageCommittee = input<boolean>(false);
  public myCommitteeUids = input<Set<string>>(new Set());
  public readonly committeeLabel = COMMITTEE_LABEL;
  public searchForm = input.required<FormGroup>();
  public categoryOptions = input.required<{ label: string; value: string | null }[]>();
  public votingStatusOptions = input.required<{ label: string; value: string | null }[]>();
  public showFoundationFilter = input<boolean>(false);
  public showProjectFilter = input<boolean>(false);
  public foundationOptions = input<{ label: string; value: string | null }[]>([]);
  public projectOptions = input<{ label: string; value: string | null }[]>([]);

  // Outputs
  public readonly refresh = output<void>();
  public readonly rowClick = output<Committee>();
  public readonly foundationFilterChange = output<string | null>();
  public readonly projectFilterChange = output<string | null>();

  // Writable signals
  protected readonly categoryTab = signal<string>('all');

  // State
  protected readonly isBoardMember = computed(() => this.personaService.currentPersona() === 'board-member');

  private readonly formValue = toSignal(toObservable(this.searchForm).pipe(switchMap((form) => form.valueChanges.pipe(startWith(form.value)))), {
    initialValue: {} as Record<string, unknown>,
  });

  protected readonly isFiltered = computed(() => {
    const v = this.formValue();
    return !!v['search'] || !!v['category'] || !!v['votingStatus'] || !!v['foundationFilter'] || !!v['projectFilter'];
  });

  protected readonly rppOptions = computed<number[] | undefined>(() => (this.committees().length > 10 ? [10, 25, 50] : undefined));

  protected readonly categoryTabOptions = computed<FilterPillOption[]>(() =>
    this.categoryOptions().map((opt) => {
      const fullLabel = opt.label ?? 'All';
      const truncatedLabel = this.truncateTabLabel(fullLabel);
      return {
        id: opt.value ?? 'all',
        label: truncatedLabel,
        fullLabel: truncatedLabel !== fullLabel ? fullLabel : undefined,
      };
    })
  );

  protected onRowSelect(event: { data: Committee }): void {
    this.rowClick.emit(event.data);
  }

  protected onCategoryTabChange(tab: string): void {
    this.categoryTab.set(tab);
    this.searchForm().patchValue({ category: tab === 'all' ? null : tab });
  }

  protected resetFilters(): void {
    this.categoryTab.set('all');
    this.searchForm().patchValue({ search: '', category: null, votingStatus: null, foundationFilter: null, projectFilter: null });
    this.foundationFilterChange.emit(null);
    this.projectFilterChange.emit(null);
  }

  private truncateTabLabel(label: string): string {
    const match = label.match(/^(.+) \((\d+)\)$/);
    if (!match) return label;
    const [, name, count] = match;
    if (name.length <= 20) return label;
    return `${name.slice(0, 20)}...(${count})`;
  }
}
