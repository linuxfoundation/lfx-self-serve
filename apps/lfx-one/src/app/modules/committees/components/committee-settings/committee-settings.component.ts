// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import { SelectComponent } from '@components/select/select.component';
import { TagComponent } from '@components/tag/tag.component';
import { ToggleComponent } from '@components/toggle/toggle.component';
import { COMMITTEE_LABEL, COMMITTEE_SETTINGS_FEATURES, JOIN_MODE_OPTIONS, MEMBER_VISIBILITY_OPTIONS } from '@lfx-one/shared/constants';

@Component({
  selector: 'lfx-committee-settings',
  imports: [ReactiveFormsModule, MessageComponent, SelectComponent, TagComponent, ToggleComponent, InputTextComponent, ButtonComponent],
  templateUrl: './committee-settings.component.html',
})
export class CommitteeSettingsComponent {
  // Form group input from parent
  public readonly form = input.required<FormGroup>();
  public readonly showHeader = input<boolean>(true);
  /** Whether the committee already has a Slack webhook configured (from Committee.has_slack_webhook — the raw URL is write-only and never reaches this component). */
  public readonly slackWebhookConfigured = input<boolean>(false);
  /** Whether the "Replace" affordance has been opened, revealing the input for a new webhook URL. */
  public readonly editingSlackWebhookUrl = input<boolean>(false);

  // Outputs
  public readonly startEditingSlackWebhookUrl = output<void>();

  // Constants from shared package
  public readonly features = COMMITTEE_SETTINGS_FEATURES;
  public readonly committeeLabel = COMMITTEE_LABEL.singular;
  public readonly memberVisibilityOptions = MEMBER_VISIBILITY_OPTIONS;
  public readonly joinModeOptions = JOIN_MODE_OPTIONS;
}
