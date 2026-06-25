// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, model } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { DrawerModule } from 'primeng/drawer';

import { NewsletterPreviewComponent } from '../newsletter-preview/newsletter-preview.component';

@Component({
  selector: 'lfx-newsletter-preview-drawer',
  imports: [DrawerModule, ButtonComponent, NewsletterPreviewComponent],
  templateUrl: './newsletter-preview-drawer.component.html',
})
export class NewsletterPreviewDrawerComponent {
  // === Inputs (pass-through to the preview component) ===
  public readonly subject = input.required<string>();
  public readonly bodyHtml = input.required<string>();
  public readonly logoUrl = input<string | undefined>(undefined);
  public readonly displayName = input.required<string>();

  // === Model Signals (two-way) ===
  public readonly visible = model<boolean>(false);

  public onClose(): void {
    this.visible.set(false);
  }
}
