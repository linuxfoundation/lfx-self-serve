// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

/**
 * The design's question-mark tip: focusable, shown on hover or focus, and centred below the icon (flipping above when
 * there's no room). The text names the icon for screen readers; `size` is 14px beside card titles, 13px elsewhere.
 */
@Component({
  selector: 'lfx-overview-info-tip',
  imports: [TooltipModule],
  templateUrl: './overview-info-tip.component.html',
  host: { class: 'inline-flex' },
})
export class OverviewInfoTipComponent {
  public readonly text = input.required<string>();
  public readonly size = input<'title' | 'label'>('label');
}
