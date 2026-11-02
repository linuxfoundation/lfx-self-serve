// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output, signal } from '@angular/core';

import type { AudienceReadinessAction, AudienceReadinessNotice } from '@lfx-one/shared/interfaces';

/**
 * Every reason the Audience tab is paused or limited, as ONE banner rather than a stack of them.
 *
 * The notices arrive most urgent first. The first is shown; the rest stay in the DOM behind a
 * "more" toggle, so each keeps its own test id and its text is never lost, only folded away.
 * Presentational: the tab decides which notices apply and handles the action a notice offers.
 */
@Component({
  selector: 'lfx-audience-readiness-banner',
  templateUrl: './audience-readiness-banner.component.html',
})
export class AudienceReadinessBannerComponent {
  public readonly notices = input.required<readonly AudienceReadinessNotice[]>();
  public readonly action = output<AudienceReadinessAction>();

  protected readonly expanded = signal(false);

  protected onToggle(): void {
    this.expanded.update((open) => !open);
  }
}
