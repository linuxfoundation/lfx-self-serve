// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { MenuComponent } from '@components/menu/menu.component';
import { MEETING_TIME_STATE_LABELS } from '@lfx-one/shared/constants';
import { getCurrentOrNextOccurrence, resolveTimeState } from '@lfx-one/shared/utils';
import { environment } from '@environments/environment';
import { LensService } from '@services/lens.service';
import { UserService } from '@services/user.service';
import { MenuItem } from 'primeng/api';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The meeting details V2 sticky identity bar (E1-02, #1771), replacing the app header on this page.
 * @description Left: the LFX mark, then the meeting's identity (date tile, title, `{group} · {status}`),
 * which fades in once the page header scrolls out of view (`condensed`). Right: for a signed-in
 * viewer, My Meetings and the account menu; for a visitor, a sign-in prompt, Create LFX account
 * and Sign in. The visitor branch is dormant until anonymous viewers reach V2 (rollout stage 5),
 * but it is built and tested now so that stage is a gate change, not new UI.
 *
 * Sign in keeps the current URL, query string included, as `returnTo` (FR-013). That writes
 * `?password=` into the login link only when it is already in this page's own address bar: the
 * composer's navigation-state password never appears in a URL.
 */
@Component({
  selector: 'lfx-meeting-identity-bar',
  imports: [DatePipe, RouterLink, AvatarComponent, MenuComponent],
  templateUrl: './identity-bar.component.html',
})
export class MeetingIdentityBarComponent {
  protected readonly state = inject(MeetingDetailsStateService);
  protected readonly userService = inject(UserService);
  private readonly lensService = inject(LensService);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);

  /** True once the page header has scrolled out of view; the bar then shows the meeting's identity. */
  public readonly condensed = input(false);

  /** Whether the account menu is open, for the trigger's `aria-expanded`. */
  protected readonly accountMenuOpen = signal(false);

  protected readonly userMenuItems: MenuItem[] = [
    { label: 'Profile', icon: 'fa-light fa-user', routerLink: '/profile' },
    { separator: true },
    { label: 'Logout', icon: 'fa-light fa-sign-out', url: '/logout', target: '_self' },
  ];

  protected readonly meeting = computed(() => (this.state.status() === 'ready' ? this.state.meeting() : undefined));
  /** Start of the occurrence the page is about: the current or next one, else the meeting itself. */
  protected readonly startTime: Signal<string | undefined> = this.initStartTime();
  protected readonly subtitle: Signal<string> = this.initSubtitle();
  protected readonly signInHref: Signal<string> = this.initSignInHref();

  protected navigateToMyMeetings(): void {
    this.lensService.setLens('me');
    void this.router.navigate(['/meetings']);
  }

  private initStartTime(): Signal<string | undefined> {
    return computed(() => {
      const meeting = this.meeting();
      return meeting ? (getCurrentOrNextOccurrence(meeting)?.start_time ?? meeting.start_time) : undefined;
    });
  }

  private initSubtitle(): Signal<string> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting) {
        return '';
      }
      const status = MEETING_TIME_STATE_LABELS[resolveTimeState(meeting, getCurrentOrNextOccurrence(meeting), this.state.now())];
      return [meeting.project?.name, status].filter(Boolean).join(' · ');
    });
  }

  private initSignInHref(): Signal<string> {
    const params = toSignal(this.activatedRoute.paramMap, { initialValue: this.activatedRoute.snapshot.paramMap });
    const query = toSignal(this.activatedRoute.queryParamMap, { initialValue: this.activatedRoute.snapshot.queryParamMap });
    return computed(() => {
      const search = new URLSearchParams();
      const queryParams = query();
      for (const key of queryParams.keys) {
        for (const value of queryParams.getAll(key)) {
          search.append(key, value);
        }
      }
      const queryString = search.toString();
      const returnTo = `${environment.urls.home}/meetings/${encodeURIComponent(params().get('id') ?? '')}${queryString ? `?${queryString}` : ''}`;
      return `/login?returnTo=${encodeURIComponent(returnTo)}`;
    });
  }
}
