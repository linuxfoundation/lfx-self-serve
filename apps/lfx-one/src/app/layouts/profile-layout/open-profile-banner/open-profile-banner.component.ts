// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, output } from '@angular/core';

// "Need help with your Profile?" link in the Profile & Account page head (#2986). No in-app click
// behavior on purpose: the Intercom custom launcher opens the bot keyed on the stable `open-profile-banner-link` testid.
@Component({
  selector: 'lfx-open-profile-banner',
  host: { class: 'block' },
  templateUrl: './open-profile-banner.component.html',
})
export class OpenProfileBannerComponent {
  public readonly linkClick = output<void>();
}
