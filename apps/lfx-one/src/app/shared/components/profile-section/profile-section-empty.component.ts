// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';

/** A profile section with nothing to show yet: the small empty state on a card. */
@Component({
  selector: 'lfx-profile-section-empty',
  imports: [UiEmptyStateComponent],
  templateUrl: './profile-section-empty.component.html',
  host: { class: 'block rounded-ui-md bg-white shadow-small', 'data-testid': 'profile-section-empty' },
})
export class ProfileSectionEmptyComponent {
  public readonly icon = input<string>('');
  public readonly heading = input.required<string>();
  public readonly description = input<string>('');
}
