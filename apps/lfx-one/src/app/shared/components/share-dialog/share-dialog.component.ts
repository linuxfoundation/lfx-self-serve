// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { SocialShareChannel, ShareDialogData, SocialShareLink } from '@lfx-one/shared/interfaces';
import { buildSocialShareLinks } from '@lfx-one/shared/utils';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { filter, fromEvent } from 'rxjs';

/**
 * Share a link to X, LinkedIn, Reddit or email, or copy it. Opened headless through
 * `ShareDialogService`; the body renders its own eyebrow, "Share" heading and close button.
 */
@Component({
  selector: 'lfx-share-dialog',
  imports: [ButtonComponent],
  templateUrl: './share-dialog.component.html',
})
export class ShareDialogComponent {
  public static readonly headingId = 'share-dialog-heading';

  // === Services ===
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<ShareDialogData>);
  private readonly clipboardShare = inject(ClipboardShareService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  // === Dialog Data ===
  private readonly data = this.config.data as ShareDialogData;
  protected readonly headingId = ShareDialogComponent.headingId;
  protected readonly eyebrow = this.data.eyebrow ?? this.data.title;
  protected readonly links: SocialShareLink[] = buildSocialShareLinks(this.data.url, this.data.title);

  // === Constructor ===
  public constructor() {
    this.initEscapeToClose();
  }

  // === Protected Methods ===
  protected onCopyLink(): void {
    if (this.clipboardShare.copyLink(this.data.url, this.data.copiedMessage ?? 'Link copied to clipboard.')) {
      this.reportShare('copy_link');
    }
  }

  /** A destination link was activated; the browser still follows its href. */
  protected onShareLink(link: SocialShareLink): void {
    this.reportShare(link.key);
  }

  /** Middle-click opens the link natively through `auxclick`, not `click`; right-click (button 2) is not a share. */
  protected onShareLinkAuxClick(event: MouseEvent, link: SocialShareLink): void {
    if (event.button === 1) {
      this.reportShare(link.key);
    }
  }

  protected onClose(): void {
    this.dialogRef.close();
  }

  // === Private Initializers ===
  /**
   * Escape closes only this dialog. PrimeNG overlays (e.g. the newsletter drawer this opens over) listen
   * for Escape on `document` without checking whether they are the top layer, so the key is claimed in
   * the window capture phase — before any `document` listener runs — and not passed on.
   */
  private initEscapeToClose(): void {
    const win = this.document.defaultView;
    if (!win) return;

    fromEvent<KeyboardEvent>(win, 'keydown', { capture: true })
      .pipe(
        filter((event) => event.key === 'Escape'),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event) => {
        event.stopPropagation();
        this.onClose();
      });
  }

  // === Private Helpers ===
  private reportShare(channel: SocialShareChannel): void {
    this.data.onShare?.(channel);
  }
}
