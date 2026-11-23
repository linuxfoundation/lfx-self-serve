// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input, model, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { NewsletterShareEvent, NewsletterShareTarget } from '@lfx-one/shared/interfaces';
import { ShareDialogService } from '@services/share-dialog.service';
import { DrawerModule } from 'primeng/drawer';

import { NewsletterPreviewComponent } from '../newsletter-preview/newsletter-preview.component';
import { ShareButtonComponent } from '../share-button/share-button.component';

@Component({
  selector: 'lfx-newsletter-preview-drawer',
  imports: [DrawerModule, ButtonComponent, NewsletterPreviewComponent, ShareButtonComponent],
  templateUrl: './newsletter-preview-drawer.component.html',
})
export class NewsletterPreviewDrawerComponent {
  // === Services ===
  private readonly shareDialog = inject(ShareDialogService);

  // === Inputs (pass-through to the preview component) ===
  public readonly subject = input.required<string>();
  public readonly bodyHtml = input.required<string>();
  public readonly logoUrl = input<string | undefined>(undefined);
  public readonly displayName = input.required<string>();
  // True when bodyHtml is a complete email document (blocks newsletter) — passed
  // through to the preview so it renders in a sandboxed iframe rather than the
  // frontend chrome. See NewsletterPreviewComponent.fullDocument.
  public readonly fullDocument = input<boolean>(false);
  public readonly sendDate = input<string | null | undefined>(undefined);

  // === Inputs (drawer header) ===
  // Defaults keep the sender-side "Preview" framing used by the manage and
  // list pages; reader-side pages (My Newsletters) pass their own text.
  public readonly headerTitle = input<string>('Preview');
  public readonly headerSubtitle = input<string>('As your recipients will see it');

  // === Inputs (share affordance) ===
  // Optional: when set, shows open-in-new-tab and Share buttons in the header. Only reader-side
  // pages (My Newsletters, reader page) provide this; manager preview flows omit it.
  public readonly shareUrl = input<string | null>(null);
  /** Share count shown on the Share button; null hides it (unknown, or a manager preview). */
  public readonly shareCount = input<number | null>(null);
  /** The issue shown — captured when the dialog opens, so shares stay bound to it. Null: shares aren't reported. */
  public readonly shareTarget = input<NewsletterShareTarget | null>(null);

  // === Outputs ===
  /** A share was made from the dialog — the parent records it and updates its count. */
  public readonly shared = output<NewsletterShareEvent>();

  // === Model Signals (two-way) ===
  public readonly visible = model<boolean>(false);

  public onShare(): void {
    const url = this.shareUrl();
    if (!url) return;

    const target = this.shareTarget();
    this.shareDialog.open({
      url,
      title: this.subject(),
      copiedMessage: 'Newsletter link copied to clipboard.',
      onShare: (channel) => {
        if (target) this.shared.emit({ ...target, channel });
      },
    });
  }

  public onClose(): void {
    this.visible.set(false);
  }
}
