// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

/** The design's question-mark tip: focusable, and shown on hover or focus; the text names the icon for screen readers. */
@Component({
  selector: 'lfx-overview-info-tip',
  imports: [TooltipModule],
  templateUrl: './overview-info-tip.component.html',
  host: { class: 'inline-flex' },
})
export class OverviewInfoTipComponent {
  public readonly text = input.required<string>();
}
