// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, DestroyRef, inject, input, model, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { NewsletterShareEvent, NewsletterShareTarget } from '@lfx-one/shared/interfaces';
import { ShareDialogService } from '@services/share-dialog.service';
import { DrawerModule } from 'primeng/drawer';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

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
  private readonly destroyRef = inject(DestroyRef);

  /** The Share dialog this drawer opened. It reports shares through `shared`, so it must not outlive the drawer. */
  private shareDialogRef: DynamicDialogRef | null = null;

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

  // === Constructor ===
  public constructor() {
    // The dialog is root-scoped and outlives this drawer (e.g. browser Back leaves the page). Once the drawer
    // is gone nobody listens to `shared`, so a share from the orphaned dialog would go unrecorded: close it.
    this.destroyRef.onDestroy(() => this.shareDialogRef?.close());
  }

  public onShare(): void {
    const url = this.shareUrl();
    if (!url) return;

    const target = this.shareTarget();
    this.shareDialogRef = this.shareDialog.open({
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
