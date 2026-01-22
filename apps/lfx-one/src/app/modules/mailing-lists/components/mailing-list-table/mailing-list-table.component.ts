// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, Signal } from '@angular/core';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
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

  // Constants
  protected readonly maxVisibleGroups = MAILING_LIST_MAX_VISIBLE_GROUPS;
  protected readonly committeeLabel = COMMITTEE_LABEL;

  // State
  public isBoardMember: Signal<boolean> = computed(() => this.personaService.currentPersona() === 'board-member');

  // Outputs
  public readonly refresh = output<void>();
}
