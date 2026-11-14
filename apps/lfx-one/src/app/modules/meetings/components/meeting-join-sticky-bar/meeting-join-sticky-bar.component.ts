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
 * @description The primary action is chosen by the parent: **Resend Invite** for someone who is invited (the same self-resend
 * the page already offers, so the calendar entry stays the one the invitation created), or **Subscribe to calendar** (the
 * project's calendar feed) for a viewer who is not. Below it, a Join button stays disabled (showing the unlock time) until the
 * join window opens. The bar is phone chrome: it is hidden from `sm:` up by CSS, and it only tells the shell about itself (so
 * the support launcher steps aside) at phone width. The parent decides when the bar exists at all (signed in, full access,
 * meeting not ended) and when it is `suppressed` (a full-screen overlay is open).
 */
@Component({
  selector: 'lfx-meeting-join-sticky-bar',
  imports: [ButtonComponent],
  templateUrl: './meeting-join-sticky-bar.component.html',
})
export class MeetingJoinStickyBarComponent {
  private readonly overlayState = inject(OverlayStateService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Which primary action to offer; `null` shows only the Join row. */
  public readonly primaryAction = input<'resend' | 'subscribe' | null>(null);
  /** True while the self-resend request is in flight (same state the page's own Resend Invite button shows). */
  public readonly resending = input<boolean>(false);
  /** Whether the join window is open. */
  public readonly canJoin = input<boolean>(false);
  /** Resolved join URL; while `canJoin` is true and this is empty (and `joinUnavailable` is false) Join shows its loading state. */
  public readonly joinHref = input<string | undefined>(undefined);
  /** True when the join URL cannot be resolved (error, or the guest form is the way in): Join stays disabled, not loading. */
  public readonly joinUnavailable = input<boolean>(false);
  /** Text for the disabled Join button, e.g. `Join opens 11:50 AM`. */
  public readonly unlockLabel = input<string>('Join Meeting');
  /** Hides the bar (and releases the launcher) while a full-screen overlay is open. */
  public readonly suppressed = input<boolean>(false);

  public readonly resendInvite = output<void>();
  /** Asks the page to open the calendar subscribe dialog. */
  public readonly subscribeCalendar = output<void>();

  /** The join URL only when it is a plain http(s) link; anything else is never bound to an anchor. */
  protected readonly safeJoinHref = computed(() => this.toHttpUrl(this.joinHref()));

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

  private toHttpUrl(href: string | undefined): string | undefined {
    return href && /^https?:\/\//i.test(href) ? href : undefined;
  }
}
