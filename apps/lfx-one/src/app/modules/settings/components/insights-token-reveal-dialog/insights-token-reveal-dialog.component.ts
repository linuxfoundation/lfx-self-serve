// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, inject, PLATFORM_ID, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { INSIGHTS_PUBLIC_API_DOCS_URL, INSIGHTS_PUBLIC_API_EXAMPLE_URL, INSIGHTS_TOKEN_COPIED_RESET_MS } from '@lfx-one/shared/constants';
import { InsightsTokenRevealDialogData } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/** One-time reveal of a newly created LFX Insights API token secret, with a usage snippet. */
@Component({
  selector: 'lfx-insights-token-reveal-dialog',
  imports: [ButtonComponent],
  templateUrl: './insights-token-reveal-dialog.component.html',
})
export class InsightsTokenRevealDialogComponent {
  /** The opener passes this to `nameDynamicDialog` so the headless dialog is named by its heading. */
  public static readonly headingId = 'insights-token-reveal-heading';

  private readonly dialogConfig = inject<DynamicDialogConfig<InsightsTokenRevealDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly headingId = InsightsTokenRevealDialogComponent.headingId;
  protected readonly secret = typeof this.dialogConfig.data?.secret === 'string' ? this.dialogConfig.data.secret : '';
  protected readonly exampleUrl = INSIGHTS_PUBLIC_API_EXAMPLE_URL;
  protected readonly docsUrl = INSIGHTS_PUBLIC_API_DOCS_URL;
  protected readonly copied = signal(false);

  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  public constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.clearCopiedTimer();
    });
  }

  /**
   * Writes straight to the async Clipboard API. Not CDK `Clipboard`: its fallback copies from a temporary,
   * unmasked `<textarea>` on `document.body`, which Datadog Session Replay would record with the live secret.
   */
  protected async copy(): Promise<void> {
    try {
      if (!this.secret || !isPlatformBrowser(this.platformId) || !navigator.clipboard) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(this.secret);
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Copy failed', detail: 'Select the token and copy it manually.' });
      return;
    }
    if (this.destroyed) {
      return;
    }

    this.copied.set(true);
    this.clearCopiedTimer();
    this.copiedTimer = setTimeout(() => this.copied.set(false), INSIGHTS_TOKEN_COPIED_RESET_MS);
  }

  protected close(): void {
    this.dialogRef.close();
  }

  private clearCopiedTimer(): void {
    if (this.copiedTimer) {
      clearTimeout(this.copiedTimer);
      this.copiedTimer = null;
    }
  }
}
