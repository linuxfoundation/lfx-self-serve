// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { shareButtonAriaLabel, visibleShareCount } from '@lfx-one/shared/utils';

/**
 * Newsletter Share button with the issue's share count ("Share · 12"), used by the reader drawer. The
 * reader page shows the same count on `NewsletterEngagementRailComponent` instead. The count is hidden
 * while unknown (null) or zero; both share the rule and label via `visibleShareCount` / `shareButtonAriaLabel`.
 */
@Component({
  selector: 'lfx-newsletter-share-button',
  imports: [DecimalPipe],
  templateUrl: './share-button.component.html',
})
export class ShareButtonComponent {
  // === Inputs ===
  public readonly count = input<number | null>(null);
  public readonly testId = input<string>('newsletter-share-button');

  // === Outputs ===
  public readonly share = output<void>();

  // === Computed ===
  protected readonly visibleCount = computed(() => visibleShareCount(this.count()));
  protected readonly ariaLabel = computed(() => shareButtonAriaLabel(this.visibleCount()));
}
