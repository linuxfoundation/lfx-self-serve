// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';

/**
 * One section of the Profile page or the public profile (#6067): a display-font heading with its description, an optional
 * right-hand slot for a hint and an action (`[profileSectionActions]`), then the section's content.
 */
@Component({
  selector: 'lfx-profile-section',
  templateUrl: './profile-section.component.html',
  host: { class: 'block' },
})
export class ProfileSectionComponent {
  public readonly heading = input.required<string>();
  public readonly description = input<string>('');
  /** Prefix for the section's test ids and heading id, e.g. `profile-recognitions`. */
  public readonly testId = input<string>('profile-section');

  protected readonly headingId = computed(() => `${this.testId()}-heading`);
}
