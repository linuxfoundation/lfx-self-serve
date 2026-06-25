// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';

@Component({
  selector: 'lfx-newsletter-preview',
  templateUrl: './newsletter-preview.component.html',
  styleUrl: './newsletter-preview.component.scss',
})
export class NewsletterPreviewComponent {
  // Inputs
  public readonly subject = input<string>('');
  public readonly bodyHtml = input<string>('');
  public readonly logoUrl = input<string | undefined>(undefined);
  public readonly displayName = input<string>('');

  // Computed
  public readonly hasContent: Signal<boolean> = computed(() => Boolean(this.subject().trim() || this.bodyHtml().trim()));
}
