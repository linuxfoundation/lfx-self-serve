// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { SettingsCardComponent } from '@components/settings-card/settings-card.component';
import { ToggleComponent } from '@components/toggle/toggle.component';
import { MailingListAudienceAccess } from '@lfx-one/shared/enums';
import { RadioButtonModule } from 'primeng/radiobutton';

@Component({
  selector: 'lfx-mailing-list-settings',
  imports: [ReactiveFormsModule, SettingsCardComponent, ToggleComponent, RadioButtonModule],
  templateUrl: './mailing-list-settings.component.html',
})
export class MailingListSettingsComponent {
  public readonly form = input.required<FormGroup>();
  public readonly MailingListAudienceAccess = MailingListAudienceAccess;
}
