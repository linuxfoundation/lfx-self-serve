// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { ShareDialogData, SocialShareLink } from '@lfx-one/shared/interfaces';
import { buildSocialShareLinks } from '@lfx-one/shared/utils';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

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

  // === Dialog Data ===
  private readonly data = this.config.data as ShareDialogData;
  protected readonly headingId = ShareDialogComponent.headingId;
  protected readonly eyebrow = this.data.eyebrow ?? this.data.title;
  protected readonly links: SocialShareLink[] = buildSocialShareLinks(this.data.url, this.data.title);

  // === Protected Methods ===
  protected onCopyLink(): void {
    this.clipboardShare.copyLink(this.data.url, this.data.copiedMessage ?? 'Link copied to clipboard.');
  }

  protected onClose(): void {
    this.dialogRef.close();
  }
}
