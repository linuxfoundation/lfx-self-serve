// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';

/**
 * The card both training pages show in place of the stat strip when the stats read failed: a stated error with Retry,
 * never dashes or zeros that read like "no data". `testIdPrefix` yields `<prefix>-error` and `<prefix>-retry`.
 */
@Component({
  selector: 'lfx-org-training-stats-error',
  imports: [ButtonComponent, CardComponent],
  templateUrl: './org-training-stats-error.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgTrainingStatsErrorComponent {
  public readonly testIdPrefix = input.required<string>();
  public readonly message = input<string>("Something went wrong fetching this organization's training numbers. Please try again.");

  public readonly retry = output<void>();

  protected readonly errorTestId = computed(() => `${this.testIdPrefix()}-error`);
  protected readonly retryTestId = computed(() => `${this.testIdPrefix()}-retry`);
}
