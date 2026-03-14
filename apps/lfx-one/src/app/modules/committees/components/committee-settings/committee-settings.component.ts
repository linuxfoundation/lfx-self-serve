// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MessageComponent } from '@components/message/message.component';
import { SelectComponent } from '@components/select/select.component';
import { ToggleComponent } from '@components/toggle/toggle.component';
import { COMMITTEE_LABEL, COMMITTEE_SETTINGS_FEATURES, MEMBER_VISIBILITY_OPTIONS } from '@lfx-one/shared/constants';

@Component({
  selector: 'lfx-committee-settings',
  imports: [ReactiveFormsModule, MessageComponent, SelectComponent, ToggleComponent],
  templateUrl: './committee-settings.component.html',
})
export class CommitteeSettingsComponent {
  // Form group input from parent
  public readonly form = input.required<FormGroup>();

  // Constants from shared package
  public readonly features = COMMITTEE_SETTINGS_FEATURES;
  public readonly committeeLabel = COMMITTEE_LABEL.singular;
  public readonly memberVisibilityOptions = MEMBER_VISIBILITY_OPTIONS;
}
