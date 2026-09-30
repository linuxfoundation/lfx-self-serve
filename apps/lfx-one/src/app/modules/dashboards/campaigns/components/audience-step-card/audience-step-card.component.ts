// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';

/**
 * The frame every Audience tab step renders in, so the tab reads as one numbered sequence rather
 * than five differently-styled blocks. Presentational only: the step's own content is projected.
 */
@Component({
  selector: 'lfx-audience-step-card',
  templateUrl: './audience-step-card.component.html',
})
export class AudienceStepCardComponent {
  public readonly step = input.required<number>();
  public readonly heading = input.required<string>();
  public readonly subheading = input('');
  public readonly icon = input('fa-light fa-list');
  /** Shown as a pill beside the heading; null hides it (0 is a real count and is shown). */
  public readonly count = input<number | null>(null);
  public readonly countLabel = input('selected');
  public readonly testId = input.required<string>();
}
