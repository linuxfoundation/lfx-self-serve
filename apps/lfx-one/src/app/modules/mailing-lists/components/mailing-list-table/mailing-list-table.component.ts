// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { COMMITTEE_LABEL, MAILING_LIST_LABEL, MAILING_LIST_MAX_VISIBLE_GROUPS } from '@lfx-one/shared';
import { GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { GroupEmailPipe } from '@pipes/group-email.pipe';
import { MailingListTypeLabelPipe } from '@pipes/mailing-list-type-label.pipe';
import { MailingListVisibilitySeverityPipe } from '@pipes/mailing-list-visibility-severity.pipe';
import { RemainingGroupsTooltipPipe } from '@pipes/remaining-groups-tooltip.pipe';
import { SliceLinkedGroupsPipe } from '@pipes/slice-linked-groups.pipe';
import { StripHtmlPipe } from '@pipes/strip-html.pipe';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-mailing-list-table',
  imports: [
    CardComponent,
    ButtonComponent,
    TableComponent,
    TagComponent,
    TooltipModule,
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
  // Inputs
  public mailingLists = input.required<GroupsIOMailingList[]>();
  public isMaintainer = input<boolean>(false);
  public mailingListLabel = input<string>(MAILING_LIST_LABEL.singular);

  // Constants
  protected readonly maxVisibleGroups = MAILING_LIST_MAX_VISIBLE_GROUPS;
  protected readonly committeeLabel = COMMITTEE_LABEL;

  // Outputs
  public readonly refresh = output<void>();
}
