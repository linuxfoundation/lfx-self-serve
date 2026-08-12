// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output } from '@angular/core';
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
  /**
   * Whether the committee already has a webhook configured — distinct from `slackWebhookInputVisible`.
   * Used only to pick the input-branch button's label: "Cancel" backs out to the Configured badge
   * (meaningful only when a webhook actually exists to back out to); when none is configured yet,
   * the input is the resting state — there's nothing to cancel back to, so the same button instead
   * reads "Clear" (undoes typed-but-unsaved text, staying on the empty input).
   */
  public readonly slackWebhookConfigured = input<boolean>(false);
  /**
   * Whether Remove has staged a webhook deletion for the next save — the revealed (now-empty)
   * input looks visually identical to the "no webhook configured yet" state (or to Replace with
   * everything typed back out), so this drives an explicit hint rather than leaving that
   * distinction invisible to the user.
   */
  public readonly slackWebhookRemovalStaged = input<boolean>(false);
  /**
   * Whether the caller is impersonating another user — drives the webhook card's disabled state
   * and hint text directly, not inferred from the control's own `disabled` flag. The control can
   * be disabled for other reasons too (e.g. read-only Auditor access via `form().disabled`), and
   * inferring "impersonating" from disabled-ness alone would show a false reason once a second
   * disable path exists.
   */
  public readonly impersonating = input<boolean>(false);

  // Outputs
  public readonly startEditingSlackWebhookUrl = output<void>();
  /**
   * Emitted only by the explicit Remove action, distinct from `startEditingSlackWebhookUrl`
   * (also emitted by Remove, alongside this one, to reveal the input) — lets the parent tell an
   * intentional "clear the webhook" apart from a Replace-then-cleared-back-to-empty edit, which
   * would otherwise both leave the control dirty-and-empty and look identical at save time.
   */
  public readonly removeSlackWebhookStaged = output<void>();
  /** Emitted when the user backs out of the webhook input without saving (Cancel / Undo Remove) — the parent should collapse back to the Configured badge state. */
  public readonly cancelEditingSlackWebhookUrl = output<void>();

  // Constants from shared package
  public readonly features = COMMITTEE_SETTINGS_FEATURES;
  public readonly committeeLabel = COMMITTEE_LABEL.singular;
  public readonly memberVisibilityOptions = MEMBER_VISIBILITY_OPTIONS;
  public readonly joinModeOptions = JOIN_MODE_OPTIONS;

  /** The input-branch button's base label — "Cancel" backs out to an existing webhook, "Clear" undoes typed-but-unsaved text with nothing to back out to. Extracted so the aria-label below doesn't nest a ternary inside another. */
  public readonly slackWebhookCancelLabel = computed(() => (this.slackWebhookConfigured() ? 'Cancel' : 'Clear'));
  public readonly slackWebhookCancelAriaLabel = computed(() =>
    this.impersonating() ? `${this.slackWebhookCancelLabel()} — unavailable while impersonating another user` : this.slackWebhookCancelLabel()
  );

  /**
   * Stages a removal: clears the control and marks it dirty, then reveals the input so the user
   * can enter a replacement instead if they change their mind — there is deliberately no separate
   * save path here, everything funnels through the page's single Save Changes button.
   * `removeSlackWebhookStaged` (distinct from `startEditingSlackWebhookUrl`, also emitted here) is
   * what actually tells the parent this is an intentional removal — dirty-and-empty alone is
   * ambiguous with Replace-then-cleared-back-to-empty, which must NOT delete the webhook on save.
   * The parent clears the staged flag again the moment the user types a non-empty value, so typing
   * a replacement URL after clicking Remove correctly supersedes the staged removal. The revealed
   * (now-empty) input still looks identical to the "no webhook configured yet" state, or to a
   * cleared-but-not-staged Replace — `slackWebhookRemovalStaged` drives the hint below that makes
   * "this save will delete the webhook" visible instead of a silent surprise.
   */
  public onRemoveSlackWebhook(): void {
    const control = this.form().controls['chat_webhook_url'];
    control?.setValue('');
    control?.markAsDirty();
    this.startEditingSlackWebhookUrl.emit();
    this.removeSlackWebhookStaged.emit();
  }

  /** Backs out of an in-progress edit (Replace or Remove) without saving — resets the control to pristine/empty so a half-typed or staged-for-removal value can't block the page's other saves via [disabled]="form.invalid" (Validators.pattern rejects a partial URL). */
  public onCancelSlackWebhookEdit(): void {
    const control = this.form().controls['chat_webhook_url'];
    control?.reset(null);
    this.cancelEditingSlackWebhookUrl.emit();
  }
}
