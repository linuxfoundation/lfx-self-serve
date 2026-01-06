// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TableComponent } from '@components/table/table.component';
import { MAILING_LIST_LABEL } from '@lfx-one/shared/constants';
import { GroupsIOMailingList } from '@lfx-one/shared/interfaces';

/**
 * Placeholder interface for mailing list subscribers
 * Will be replaced with actual interface when API is available
 */
export interface MailingListSubscriber {
  uid: string;
  name: string;
  email: string;
  title?: string;
  organization?: string;
  deliveryMode: 'individual' | 'digest' | 'none';
  role: 'owner' | 'moderator' | 'member';
}

@Component({
  selector: 'lfx-mailing-list-subscribers',
  imports: [CardComponent, ButtonComponent, TableComponent],
  templateUrl: './mailing-list-subscribers.component.html',
  styleUrl: './mailing-list-subscribers.component.scss',
})
export class MailingListSubscribersComponent {
  // Input
  public mailingList = input<GroupsIOMailingList | null>(null);

  // Constants
  protected readonly mailingListLabel = MAILING_LIST_LABEL;

  // Placeholder data - will be replaced with actual API data
  public readonly subscribers: MailingListSubscriber[] = [];
  public readonly loading = false;
}
