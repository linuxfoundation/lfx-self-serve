// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { IMPERSONATION_TRANSITION_MESSAGES } from '@lfx-one/shared/constants';
import { ImpersonationService } from '@services/impersonation.service';

/**
 * Full-page loading state for starting, switching and stopping impersonation. Each of those ends in a
 * full page reload, so the overlay stays up until the page unloads rather than clearing when the request
 * returns — otherwise the user sees a dead page for the duration of the reload.
 */
@Component({
  selector: 'lfx-impersonation-transition-overlay',
  templateUrl: './impersonation-transition-overlay.component.html',
})
export class ImpersonationTransitionOverlayComponent {
  private readonly impersonationService = inject(ImpersonationService);

  protected readonly message: Signal<string | null> = this.initMessage();

  private initMessage(): Signal<string | null> {
    return computed(() => {
      const transition = this.impersonationService.transition();
      return transition ? IMPERSONATION_TRANSITION_MESSAGES[transition] : null;
    });
  }
}
