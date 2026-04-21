// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, Signal } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { switchMap, startWith } from 'rxjs';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { COMMITTEE_LABEL, MAILING_LIST_LABEL, MAILING_LIST_MAX_VISIBLE_GROUPS } from '@lfx-one/shared';
import { FilterOption, GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { GroupEmailPipe } from '@pipes/group-email.pipe';
import { MailingListTypeLabelPipe } from '@pipes/mailing-list-type-label.pipe';
import { MailingListVisibilitySeverityPipe } from '@pipes/mailing-list-visibility-severity.pipe';
import { RemainingGroupsTooltipPipe } from '@pipes/remaining-groups-tooltip.pipe';
import { SliceLinkedGroupsPipe } from '@pipes/slice-linked-groups.pipe';
import { StripHtmlPipe } from '@pipes/strip-html.pipe';
import { PersonaService } from '@services/persona.service';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-mailing-list-table',
  imports: [
    ReactiveFormsModule,
    CardComponent,
    ButtonComponent,
    TableComponent,
    TagComponent,
    InputTextComponent,
    SelectComponent,
    TooltipModule,
    RouterLink,
    GroupEmailPipe,
    MailingListVisibilitySeverityPipe,
    MailingListTypeLabelPipe,
    RemainingGroupsTooltipPipe,
    SliceLinkedGroupsPipe,
    StripHtmlPipe,
    EmptyStateComponent,
  ],
  templateUrl: './mailing-list-table.component.html',
  styleUrl: './mailing-list-table.component.scss',
})
export class MailingListTableComponent {
  // Injected services
  private readonly personaService = inject(PersonaService);

  // Inputs
  public mailingLists = input.required<GroupsIOMailingList[]>();
  public isMaintainer = input<boolean>(false);
  public mailingListLabel = input<string>(MAILING_LIST_LABEL.singular);
  public searchForm = input.required<FormGroup>();
  public committeeFilterOptions = input.required<FilterOption[]>();
  public statusFilterOptions = input.required<FilterOption[]>();
  public foundationOptions = input<{ label: string; value: string | null }[]>([]);
  public projectOptions = input<{ label: string; value: string | null }[]>([]);
  public showFoundationFilter = input<boolean>(false);
  public showProjectFilter = input<boolean>(false);
  public loading = input<boolean>(false);

  // Constants
  protected readonly maxVisibleGroups = MAILING_LIST_MAX_VISIBLE_GROUPS;
  protected readonly committeeLabel = COMMITTEE_LABEL;

  // Outputs
  public readonly refresh = output<void>();
  public readonly rowClick = output<GroupsIOMailingList>();
  public readonly foundationFilterChange = output<string | null>();
  public readonly projectFilterChange = output<string | null>();

  // State
  public isBoardMember: Signal<boolean> = computed(() => this.personaService.currentPersona() === 'board-member');

  private readonly formValue = toSignal(
    toObservable(this.searchForm).pipe(switchMap((form) => form.valueChanges.pipe(startWith(form.value)))),
    { initialValue: {} as Record<string, unknown> }
  );

  protected readonly isFiltered = computed(() => {
    const v = this.formValue();
    return !!v['search'] || !!v['committee'] || !!v['status'] || !!v['foundationFilter'] || !!v['projectFilter'];
  });

  protected readonly rppOptions = computed<number[] | undefined>(() => (this.mailingLists().length > 10 ? [10, 25, 50] : undefined));

  // Event Handlers
  protected onRowSelect(event: { data: GroupsIOMailingList }): void {
    this.rowClick.emit(event.data);
  }

  protected resetFilters(): void {
    this.searchForm().patchValue({ search: '', committee: null, status: null, foundationFilter: null, projectFilter: null });
    this.foundationFilterChange.emit(null);
    this.projectFilterChange.emit(null);
  }
}
