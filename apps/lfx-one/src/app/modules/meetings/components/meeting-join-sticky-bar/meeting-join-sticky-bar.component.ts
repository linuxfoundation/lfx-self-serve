// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, effect, inject, input, output, PLATFORM_ID } from '@angular/core';
import { PHONE_MEDIA_QUERY } from '@lfx-one/shared/constants';

import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { OverlayStateService } from '../../../../shared/services/overlay-state.service';

/**
 * Phone-only sticky action bar for a signed-in viewer of a meeting (#4862).
 * @description Add to calendar is the primary action, with a Google Calendar link beside it and a Join button that
 * stays disabled (showing the unlock time) until the join window opens. The bar is phone chrome: it is hidden from
 * `sm:` up by CSS, and it only tells the shell about itself (so the support launcher steps aside) at phone width.
 * The parent decides when the bar exists at all (signed in, full access, meeting not ended) and when it is
 * `suppressed` (a full-screen overlay is open or a form field has focus).
 */
@Component({
  selector: 'lfx-meeting-join-sticky-bar',
  imports: [ButtonComponent],
  templateUrl: './meeting-join-sticky-bar.component.html',
})
export class MeetingJoinStickyBarComponent {
  private readonly overlayState = inject(OverlayStateService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Whether the join window is open. */
  public readonly canJoin = input<boolean>(false);
  /** Resolved join URL; while `canJoin` is true and this is empty the Join button shows its loading state. */
  public readonly joinHref = input<string | undefined>(undefined);
  /** Text for the disabled Join button, e.g. `Join opens 11:50 AM`. */
  public readonly unlockLabel = input<string>('Join Meeting');
  /** Prefilled Google Calendar URL built from the same fields as the ICS. */
  public readonly googleCalendarUrl = input<string>('');
  /** True while the ICS download is in flight. */
  public readonly calendarBusy = input<boolean>(false);
  /** Hides the bar (and releases the launcher) while a full-screen overlay is open or a field has focus. */
  public readonly suppressed = input<boolean>(false);

  public readonly addToCalendar = output<void>();

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      effect(() => {
        const occupiesScreen = !this.suppressed() && window.matchMedia(PHONE_MEDIA_QUERY).matches;
        this.overlayState.stickyBarVisible.set(occupiesScreen);
      });
      // Never strand the launcher hidden after the page goes away.
      inject(DestroyRef).onDestroy(() => this.overlayState.stickyBarVisible.set(false));
    }
  }
}
