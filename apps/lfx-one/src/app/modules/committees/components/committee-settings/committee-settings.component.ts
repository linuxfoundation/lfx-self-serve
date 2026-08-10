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
  /**
   * Whether to render the Slack Incoming Webhook card at all. Defaults to false — this
   * component is also used by the committee create/edit wizard (`committee-manage.component`),
   * whose form has no `chat_webhook_url` control; rendering the card there would either throw
   * (NG01203, if the input branch showed) or lie (a false "Configured" badge, if the badge branch
   * showed). Only `committee-settings-tab.component` — the one place with a real committee to
   * enrich and a form that declares the control — opts in.
   */
  public readonly showSlackWebhook = input<boolean>(false);
  /**
   * Whether the Slack webhook URL input is rendered/editable (vs. the "Configured" badge +
   * Replace button), when `showSlackWebhook` is true. A single source of truth computed once by
   * the parent from `Committee.has_slack_webhook` and its own "Replace clicked" state —
   * deliberately not re-derived here from two separately-passed booleans, which is how a
   * previous version of this component could show the input while the parent's save payload
   * disagreed about whether it was visible.
   */
  public readonly slackWebhookInputVisible = input<boolean>(false);

  // Outputs
  public readonly startEditingSlackWebhookUrl = output<void>();

  // Constants from shared package
  public readonly features = COMMITTEE_SETTINGS_FEATURES;
  public readonly committeeLabel = COMMITTEE_LABEL.singular;
  public readonly memberVisibilityOptions = MEMBER_VISIBILITY_OPTIONS;
  public readonly joinModeOptions = JOIN_MODE_OPTIONS;
}
