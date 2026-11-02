// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, output, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { PHONE_MEDIA_QUERY } from '@lfx-one/shared/constants';

import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { OverlayStateService } from '../../../../shared/services/overlay-state.service';

/**
 * Phone-only sticky action bar for a signed-in viewer of a meeting (#4862).
 * @description Add to calendar is the primary action, with a Google Calendar link beside it and a Join button that
 * stays disabled (showing the unlock time) until the join window opens. The bar is phone chrome: it is hidden from
 * `sm:` up by CSS, and it only tells the shell about itself (so the support launcher steps aside) at phone width.
 * The parent decides when the bar exists at all (signed in, full access, meeting not ended) and when it is
 * `suppressed` (a full-screen overlay is open).
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
  /** Resolved join URL; while `canJoin` is true and this is empty (and `joinUnavailable` is false) Join shows its loading state. */
  public readonly joinHref = input<string | undefined>(undefined);
  /** True when the join URL cannot be resolved (error, or the guest form is the way in): Join stays disabled, not loading. */
  public readonly joinUnavailable = input<boolean>(false);
  /** Text for the disabled Join button, e.g. `Join opens 11:50 AM`. */
  public readonly unlockLabel = input<string>('Join Meeting');
  /** Prefilled Google Calendar URL built from the same fields as the ICS. */
  public readonly googleCalendarUrl = input<string>('');
  /** True while the ICS download is in flight. */
  public readonly calendarBusy = input<boolean>(false);
  /** Hides the bar (and releases the launcher) while a full-screen overlay is open or a field has focus. */
  public readonly suppressed = input<boolean>(false);

  public readonly addToCalendar = output<void>();

  /** The join URL only when it is a plain http(s) link; anything else is never bound to an anchor. */
  protected readonly safeJoinHref = computed(() => {
    const href = this.joinHref();
    return href && /^https?:\/\//i.test(href) ? href : undefined;
  });

  private readonly isPhone = signal<boolean>(false);

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // Phone width is re-read on rotation/resize: CSS hides the bar from `sm:` up, and the launcher must come back with it.
      const mql = window.matchMedia(PHONE_MEDIA_QUERY);
      this.isPhone.set(mql.matches);
      const onChange = (event: MediaQueryListEvent): void => this.isPhone.set(event.matches);
      mql.addEventListener?.('change', onChange);

      toObservable(computed(() => !this.suppressed() && this.isPhone()))
        .pipe(takeUntilDestroyed())
        .subscribe((occupiesScreen) => this.overlayState.stickyBarVisible.set(occupiesScreen));
      // Never strand the launcher hidden after the page goes away.
      inject(DestroyRef).onDestroy(() => {
        mql.removeEventListener?.('change', onChange);
        this.overlayState.stickyBarVisible.set(false);
      });
    }
  }
}
