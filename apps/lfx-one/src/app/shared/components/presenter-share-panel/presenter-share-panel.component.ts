// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, DestroyRef, inject, input, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { QrCodeComponent } from '@components/qr-code/qr-code.component';
import { VOTE_PRESENTER_COPY_CONFIRMATION_MS } from '@lfx-one/shared/constants';

/**
 * Link-first share panel for presenter views: the large link, a Copy link button with its own status, a slot for extra
 * actions (the vote presenter puts Send ballots now there), the QR code and a footnote.
 * @description Copy status and its reset timer live here. The host is `display: contents` so the card stays a direct flex
 * child of the presenter's content row, exactly as before the extraction.
 */
@Component({
  selector: 'lfx-presenter-share-panel',
  imports: [ButtonComponent, CardComponent, QrCodeComponent],
  templateUrl: './presenter-share-panel.component.html',
  host: { class: 'contents' },
})
export class PresenterSharePanelComponent {
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly link = input.required<string>();
  /** Accessible label for the QR code. */
  public readonly qrLabel = input.required<string>();
  public readonly copyLabel = input<string>('Copy link');
  /** Label shown on the button while the copy confirmation is up. */
  public readonly copiedLabel = input<string>('Link copied');
  public readonly footnote = input.required<string>();

  // === Writable Signals ===
  protected readonly copied = signal(false);
  protected readonly copyFailed = signal(false);

  private copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
    });
  }

  // === Protected Methods ===
  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link());
      this.copyFailed.set(false);
      this.copied.set(true);
      if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
      this.copyResetTimer = setTimeout(() => this.copied.set(false), VOTE_PRESENTER_COPY_CONFIRMATION_MS);
    } catch {
      this.copied.set(false);
      this.copyFailed.set(true);
    }
  }
}
