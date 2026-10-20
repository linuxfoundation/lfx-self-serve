// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { MenuComponent } from '@components/menu/menu.component';
import { MEETING_STATUS_LABELS } from '@lfx-one/shared/constants';
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
  private readonly router = inject(Router);
  private readonly lensService = inject(LensService);

  /** True once the page header has scrolled out of view; the bar then shows the meeting's identity. */
  public readonly condensed = input(false);

  /** Whether the account menu is open, for the trigger's `aria-expanded`. */
  protected readonly accountMenuOpen = signal(false);

  /**
   * The account menu (E10-03, #3603): Manage identities, Profile and Logout, under a plain line saying
   * who is signed in (the menu's start, not a menu item, so it is read and never skipped as disabled).
   * No account switcher and no credential input: an identity links to one LFX account, so the remedy
   * for a second address is linking it on the identities page, and sign-in stays with Auth0. While
   * impersonating, the banner says whose account it is, and identity changes are blocked: neither the
   * line nor Manage identities shows.
   */
  protected readonly userMenuItems: Signal<MenuItem[]> = this.initUserMenuItems();
  protected readonly accountLabel: Signal<string> = this.initAccountLabel();

  protected readonly meeting = computed(() => (this.state.status() === 'ready' ? this.state.meeting() : undefined));
  /** Start of the page's selected occurrence (the state service's), else of the meeting itself. */
  protected readonly startTime: Signal<string | undefined> = this.initStartTime();
  protected readonly subtitle: Signal<string> = this.initSubtitle();
  /** The state service's sign-in link, which the action slot shares (FR-013). */
  protected readonly signInHref: Signal<string> = this.state.signInHref;

  protected navigateToMyMeetings(): void {
    this.lensService.setLens('me');
    void this.router.navigate(['/meetings']);
  }

  private initStartTime(): Signal<string | undefined> {
    return computed(() => {
      const meeting = this.meeting();
      return meeting ? (this.state.selectedOccurrence()?.start_time ?? meeting.start_time) : undefined;
    });
  }

  private initSubtitle(): Signal<string> {
    return computed(() => {
      const meeting = this.meeting();
      const status = this.state.meetingStatus();
      if (!meeting || !status) {
        return '';
      }
      // The state service's status, which the header's pill shows too (E1-05).
      const label = MEETING_STATUS_LABELS[status];
      return [meeting.project?.name, label].filter(Boolean).join(' · ');
    });
  }

  private initUserMenuItems(): Signal<MenuItem[]> {
    return computed(() => [
      // Not while impersonating: every identity change is blocked then, and the page would be someone else's.
      ...(this.userService.impersonating()
        ? []
        : [{ label: 'Manage identities', icon: 'fa-light fa-id-card', routerLink: '/profile/identities', id: 'meeting-identity-bar-manage-identities' }]),
      { label: 'Profile', icon: 'fa-light fa-user', routerLink: '/profile' },
      { separator: true },
      { label: 'Logout', icon: 'fa-light fa-sign-out', url: '/logout', target: '_self' },
    ]);
  }

  /** The trigger's accessible name: whose account, with the email the narrow layout hides. */
  private initAccountLabel(): Signal<string> {
    return computed(() => {
      const user = this.userService.user();
      const name = user?.name || 'your account';
      return user?.email ? `Account menu for ${name}, ${user.email}` : `Account menu for ${name}`;
    });
  }
}
