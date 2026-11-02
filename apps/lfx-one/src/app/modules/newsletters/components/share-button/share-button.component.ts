// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';

/**
 * Newsletter Share button with the issue's share count ("Share · 12"), used by the reader page and
 * the reader drawer. The count is hidden while unknown (null) or zero.
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
  protected readonly visibleCount = computed(() => {
    const count = this.count();
    return count && count > 0 ? count : null;
  });
  protected readonly ariaLabel = computed(() => {
    const count = this.visibleCount();
    if (count === null) return 'Share';
    return count === 1 ? 'Share, shared 1 time' : `Share, shared ${count} times`;
  });
}
