// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { MessageComponent } from '@components/message/message.component';

@Component({
  selector: 'lfx-events-info-banners',
  imports: [MessageComponent],
  templateUrl: './events-info-banners.component.html',
})
export class EventsInfoBannersComponent {
  public readonly discoverUrl = input.required<string>();
}
