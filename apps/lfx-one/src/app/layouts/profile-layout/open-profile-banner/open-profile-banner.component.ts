// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, output } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

// "Can’t find what you need here?" link in the Profile & Account page head (#2986) — label/tooltip are copy-only;
// no in-app click behavior: the Intercom custom launcher opens the bot keyed on the `open-profile-banner-link` testid.
@Component({
  selector: 'lfx-open-profile-banner',
  host: { class: 'block' },
  imports: [TooltipModule],
  templateUrl: './open-profile-banner.component.html',
})
export class OpenProfileBannerComponent {
  public readonly linkClick = output<void>();
}
