// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { ButtonComponent } from '@app/shared/components/button/button.component';
import { LINKS_CONFIG } from '@lfx-one/shared/constants';

@Component({
  selector: 'lfx-discover-events-button',
  imports: [ButtonComponent],
  templateUrl: './discover-events-button.component.html',
})
export class DiscoverEventsButtonComponent {
  public readonly testId = input<string>('discover-events-button');
  protected readonly discoverUrl = LINKS_CONFIG.EVENTS.DISCOVER;
}
