// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import {
  ACCOUNT_DEVELOPER_SETTINGS_COPY,
  INSIGHTS_PUBLIC_API_DOCS_URL,
  INSIGHTS_PUBLIC_API_EXAMPLE_URL,
  INSIGHTS_TOKEN_COPIED_RESET_MS,
} from '@lfx-one/shared/constants';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { MessageService } from 'primeng/api';

import { InsightsTokenCreateDialogComponent } from '../../../../settings/components/insights-token-create-dialog/insights-token-create-dialog.component';
import { AccountInsightsTokenDialogRef } from './account-insights-token-dialog-ref';

/**
 * "New LFX Insights API token" on Account & Settings › Developer settings (#6081): the name and expiration, then, in the same
 * dialog, the one-time secret with Copy and how to use it. It keeps the create form's rules and errors by extending it.
 */
@Component({
  selector: 'lfx-account-insights-token-dialog',
  imports: [DatePipe, ReactiveFormsModule, UiButtonComponent, UiInputComponent, UiModalComponent, UiNoteComponent, UiOptionComponent, UiSelectComponent],
  templateUrl: './account-insights-token-dialog.component.html',
})
export class AccountInsightsTokenDialogComponent extends InsightsTokenCreateDialogComponent {
  private readonly steps = inject(AccountInsightsTokenDialogRef);
  private readonly platform = inject(PLATFORM_ID);
  private readonly toasts = inject(MessageService);

  protected readonly copy = ACCOUNT_DEVELOPER_SETTINGS_COPY;
  protected readonly docsLink = INSIGHTS_PUBLIC_API_DOCS_URL;
  protected readonly exampleUrl = INSIGHTS_PUBLIC_API_EXAMPLE_URL;
  protected readonly created = this.steps.created;
  protected readonly secretCopied = signal(false);
  /** The name field's message: the server's, else the length or control-character rule it breaks. */
  protected readonly nameError: Signal<string> = this.initNameError();
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    super();
    inject(DestroyRef).onDestroy(() => this.clearCopiedTimer());
  }

  protected close(): void {
    this.steps.close();
  }

  /**
   * Writes straight to the async Clipboard API. Not CDK `Clipboard`: its fallback copies from a temporary, unmasked
   * `<textarea>` on `document.body`, which Datadog Session Replay would record with the live secret.
   */
  protected async copySecret(): Promise<void> {
    const secret = this.created()?.secret ?? '';
    try {
      if (!secret || !isPlatformBrowser(this.platform) || !navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(secret);
    } catch {
      this.toasts.add({ severity: 'error', summary: 'Copy failed', detail: 'Select the token and copy it manually.' });
      return;
    }
    this.secretCopied.set(true);
    this.clearCopiedTimer();
    this.copiedTimer = setTimeout(() => this.secretCopied.set(false), INSIGHTS_TOKEN_COPIED_RESET_MS);
  }

  private initNameError(): Signal<string> {
    return computed(() => {
      if (this.errorMessage()) return this.errorMessage() ?? '';
      if (this.tooLong()) return `Use ${this.maxLength} characters or fewer.`;
      return this.hasControlCharacters() ? 'Remove tabs, line breaks, and other control characters.' : '';
    });
  }

  private clearCopiedTimer(): void {
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.copiedTimer = null;
  }
}
