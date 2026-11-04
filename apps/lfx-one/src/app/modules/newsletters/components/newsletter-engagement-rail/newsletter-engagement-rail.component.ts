// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { shareButtonAriaLabel, visibleShareCount } from '@lfx-one/shared/utils';

/**
 * Engagement rail beside a newsletter issue on the reader page: the issue's views (raw opens) and a
 * Share button with the share count, stacked icon-over-count in the style of social feeds. Vertical
 * beside the issue on large screens; a row above it on smaller ones.
 *
 * Views are display-only and hidden entirely while unknown (null); zero is a real count and shows.
 * The share count is hidden while unknown or zero, with the same rule and label as the drawer's Share
 * button (`visibleShareCount` / `shareButtonAriaLabel`).
 *
 * Test ids derive from `testId`: `<testId>-engagement-rail`, `<testId>-views(-count)`, `<testId>-share(-count)`.
 */
@Component({
  selector: 'lfx-newsletter-engagement-rail',
  imports: [DecimalPipe],
  templateUrl: './newsletter-engagement-rail.component.html',
})
export class NewsletterEngagementRailComponent {
  // === Inputs ===
  public readonly views = input<number | null>(null);
  public readonly shares = input<number | null>(null);
  public readonly testId = input<string>('newsletter');

  // === Outputs ===
  public readonly share = output<void>();

  // === Computed ===
  protected readonly visibleShares = computed(() => visibleShareCount(this.shares()));
  protected readonly viewsLabel = computed(() => {
    const count = this.views() ?? 0;
    return count === 1 ? 'Viewed 1 time' : `Viewed ${count.toLocaleString('en-US')} times`;
  });
  protected readonly shareLabel = computed(() => shareButtonAriaLabel(this.visibleShares()));
}
