// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass, NgTemplateOutlet } from '@angular/common';
import { afterRenderEffect, Component, ElementRef, inject, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { ImpersonationBannerComponent } from '@components/impersonation-banner/impersonation-banner.component';
import { UserService } from '@services/user.service';
import { SkeletonModule } from 'primeng/skeleton';

import { MeetingIdentityBarComponent } from './components/identity-bar/identity-bar.component';
import { MeetingDetailsStateService } from './meeting-details-state.service';

/**
 * The meeting details v2 page (epic #1765), rendered by {@link MeetingDetailsGateComponent} only
 * for a signed-in viewer targeted by `MEETING_V2_ENABLED_FLAG`. The pre-v2 page lives in
 * `meeting-join-v1/` and is what everyone else sees.
 *
 * This is the E1-01 shell (#1770): the three top-level branches (error, page, skeleton) and the
 * prototype's two-column layout, a content column and a sticky action rail, collapsing to one
 * column at 920px and below. Each Phase 1 section replaces one of the shell's placeholders and
 * reads the meeting from {@link MeetingDetailsStateService}, which this component provides so the
 * whole tree shares one lookup. Layout and conventions: `specs/011-meeting-details-redesign/v2-scaffold.md`.
 */
@Component({
  selector: 'lfx-meeting-details-page',
  imports: [NgClass, NgTemplateOutlet, ButtonComponent, ImpersonationBannerComponent, MeetingIdentityBarComponent, SkeletonModule],
  providers: [MeetingDetailsStateService],
  templateUrl: './meeting-details-page.component.html',
  styleUrl: './meeting-details-page.component.scss',
})
export class MeetingDetailsPageComponent {
  protected readonly state = inject(MeetingDetailsStateService);
  protected readonly userService = inject(UserService);

  /** True once the page header has scrolled behind the sticky identity bar. */
  protected readonly headerOutOfView = signal(false);
  private readonly header = viewChild<ElementRef<HTMLElement>>('header');
  private readonly bar = viewChild('identityBar', { read: ElementRef });
  private readonly platformId = inject(PLATFORM_ID);

  public constructor() {
    // An IntersectionObserver rather than a scroll listener, re-attached whenever the header element
    // changes (it exists only in the `ready` branch). `afterRenderEffect` never runs on the server.
    afterRenderEffect((onCleanup) => {
      const header = this.header()?.nativeElement;
      // Read so the observer is rebuilt when the impersonation banner moves the bar down.
      this.userService.impersonating();
      // The feature check covers runtimes without the API (old browsers, jsdom).
      if (!header || !isPlatformBrowser(this.platformId) || typeof IntersectionObserver === 'undefined') {
        this.headerOutOfView.set(false);
        return;
      }

      // The header counts as gone once it is behind the sticky bar, not once it leaves the viewport,
      // so the top margin is where the bar ends: measured, because it moves with the impersonation
      // banner and with the bar's own content.
      const barBottom = Math.round((this.bar()?.nativeElement as HTMLElement | undefined)?.querySelector('header')?.getBoundingClientRect().bottom ?? 0);
      // A fast scroll can deliver several entries in one batch; the last is the current state.
      const observer = new IntersectionObserver((entries) => this.headerOutOfView.set(!entries[entries.length - 1].isIntersecting), {
        rootMargin: `-${barBottom}px 0px 0px 0px`,
      });
      observer.observe(header);
      onCleanup(() => observer.disconnect());
    });
  }
}
