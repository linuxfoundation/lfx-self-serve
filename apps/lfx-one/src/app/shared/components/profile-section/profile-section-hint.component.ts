// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

/** The owner's "Missing a …?" hint beside a profile section heading: an eyes icon and a dashed-underline label that explains on hover or focus. */
@Component({
  selector: 'lfx-profile-section-hint',
  imports: [UiTooltipDirective],
  templateUrl: './profile-section-hint.component.html',
})
export class ProfileSectionHintComponent {
  public readonly label = input.required<string>();
  public readonly tip = input.required<string>();
}
