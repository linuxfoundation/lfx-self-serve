// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';

// "Still need Open Profile?" return link (LFXV2-3336), split out of SidebarComponent so the
// (click) → lfxOpenIntercom wiring is unit-testable without the sidebar's full child/service graph.
// [class.hidden] (not @if) mirrors the me-selector's SSR-hydration-safe visibility toggle.
@Component({
  selector: 'lfx-open-profile-banner',
  imports: [OpenIntercomDirective],
  templateUrl: './open-profile-banner.component.html',
})
export class OpenProfileBannerComponent {
  public readonly show = input.required<boolean>();
  public readonly linkClick = output<void>();
}
