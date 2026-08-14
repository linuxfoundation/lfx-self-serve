// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { Component, inject, input, model } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';

import { NewsletterPreviewComponent } from '../newsletter-preview/newsletter-preview.component';

@Component({
  selector: 'lfx-newsletter-preview-drawer',
  imports: [DrawerModule, ButtonComponent, NewsletterPreviewComponent],
  templateUrl: './newsletter-preview-drawer.component.html',
})
export class NewsletterPreviewDrawerComponent {
  // === Services ===
  private readonly clipboard = inject(Clipboard);
  private readonly messageService = inject(MessageService);

  // === Inputs (pass-through to the preview component) ===
  public readonly subject = input.required<string>();
  public readonly bodyHtml = input.required<string>();
  public readonly logoUrl = input<string | undefined>(undefined);
  public readonly displayName = input.required<string>();

  // === Inputs (drawer header) ===
  // Defaults keep the sender-side "Preview" framing used by the manage and
  // list pages; reader-side pages (My Newsletters) pass their own text.
  public readonly headerTitle = input<string>('Preview');
  public readonly headerSubtitle = input<string>('As your recipients will see it');

  // === Inputs (share affordance) ===
  // Optional: when set, shows a copy-link button in the header. Only reader-side
  // pages (My Newsletters, reader page) provide this; manager preview flows omit it.
  public readonly shareUrl = input<string | null>(null);

  // === Model Signals (two-way) ===
  public readonly visible = model<boolean>(false);

  public onCopyLink(): void {
    const url = this.shareUrl();
    if (!url) return;

    const success = this.clipboard.copy(url);
    if (success) {
      this.messageService.add({
        severity: 'success',
        summary: 'Link Copied',
        detail: 'Newsletter link copied to clipboard.',
      });
    } else {
      this.messageService.add({
        severity: 'error',
        summary: 'Copy Failed',
        detail: 'Failed to copy link. Please try again.',
      });
    }
  }

  public onClose(): void {
    this.visible.set(false);
  }
}
