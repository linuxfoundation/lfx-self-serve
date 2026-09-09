// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';

// "Still need Open Profile?" return link (LFXV2-3336), split out of SidebarComponent so the
// (click) → linkClick wiring is unit-testable without the sidebar's full child/service graph.
// The button is a plain DOM element with no Intercom wiring of its own — support tooling (e.g. an
// Intercom workflow) targets it directly by its stable data-testid, not via a custom JS event.
// [class.hidden] (not @if) mirrors the me-selector's SSR-hydration-safe visibility toggle.
@Component({
  selector: 'lfx-open-profile-banner',
  host: { class: 'block w-full' },
  templateUrl: './open-profile-banner.component.html',
})
export class OpenProfileBannerComponent {
  public readonly show = input.required<boolean>();
  public readonly linkClick = output<void>();
}
