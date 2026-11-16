// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

/** The design's 13px question-mark tip: focusable, named by its text, and showing it in the standard dark tooltip on hover or focus. */
@Component({
  selector: 'lfx-health-metrics-info-tip',
  imports: [UiTooltipDirective],
  templateUrl: './health-metrics-info-tip.component.html',
  host: { class: 'inline-flex' },
})
export class HealthMetricsInfoTipComponent {
  public readonly text = input.required<string>();
  /** Set on the icon itself, which carries the accessible name. */
  public readonly testId = input<string | null>(null);
}
