// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';

@Component({
  selector: 'lfx-insights-handoff-section',
  imports: [ButtonComponent],
  templateUrl: './insights-handoff-section.component.html',
})
export class InsightsHandoffSectionComponent {
  public readonly title = input.required<string>();
  public readonly description = input.required<string>();
  public readonly link = input.required<string>();
}
