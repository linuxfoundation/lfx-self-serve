// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { SettingsCardComponent } from '@components/settings-card/settings-card.component';
import { MAILING_LIST_MEMBER_LABEL } from '@lfx-one/shared/constants';
import { MailingListAudienceAccess } from '@lfx-one/shared/enums';
import { RadioButtonModule } from 'primeng/radiobutton';

@Component({
  selector: 'lfx-mailing-list-settings',
  imports: [ReactiveFormsModule, SettingsCardComponent, RadioButtonModule, LowerCasePipe],
  templateUrl: './mailing-list-settings.component.html',
})
export class MailingListSettingsComponent {
  public readonly form = input.required<FormGroup>();
  public readonly isEditMode = input<boolean>(false);
  public readonly initialPublicValue = input<boolean | null>(null);
  public readonly MailingListAudienceAccess = MailingListAudienceAccess;
  protected readonly memberLabel = MAILING_LIST_MEMBER_LABEL;

  // In edit mode, if the mailing list was originally private, public option should be disabled
  // Groups.io doesn't allow changing from private to public
  protected readonly isPublicDisabled = computed(() => this.isEditMode() && this.initialPublicValue() === false);
}
