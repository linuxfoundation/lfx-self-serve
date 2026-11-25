// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, computed, inject, input, PLATFORM_ID, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ACCOUNT_IDENTITIES_PATH, ACCOUNT_PERSONAL_INFORMATION_PATH, ACCOUNT_WORK_HISTORY_PATH, PROFILE_ASIDE_COPY } from '@lfx-one/shared/constants';
import { ProfileOpenprofileState } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { catchError, filter, map, Observable, of, pairwise, startWith, switchMap } from 'rxjs';

import { ProfileVisibilityDrawerService } from '../../components/profile-visibility-drawer/profile-visibility-drawer.service';

/**
 * The Profile page's right-hand rail (#6083): the openprofile card, which says whether the public profile is on and opens the
 * Open Profile settings drawer, and links to the Account & Settings pages that edit what the page shows.
 */
@Component({
  selector: 'lfx-profile-aside',
  imports: [UiButtonComponent, UiSkeletonComponent, UiTooltipDirective],
  templateUrl: './profile-aside.component.html',
})
export class ProfileAsideComponent {
  // Private injections
  private readonly userService = inject(UserService);
  private readonly visibilityDrawer = inject(ProfileVisibilityDrawerService);
  private readonly platformId = inject(PLATFORM_ID);

  // Inputs
  /** The signed-in user's username, which names the public profile: null while the profile loads, '' when none came back. */
  public readonly username = input<string | null>(null);

  protected readonly copy = PROFILE_ASIDE_COPY;
  protected readonly personalInformationPath = ACCOUNT_PERSONAL_INFORMATION_PATH;
  protected readonly identitiesPath = ACCOUNT_IDENTITIES_PATH;
  protected readonly workHistoryPath = ACCOUNT_WORK_HISTORY_PATH;

  // Simple WritableSignals
  /** This site's host, for the link shown in the card; set once the browser renders, so SSR and hydration agree. */
  protected readonly host = signal('');

  // Complex computed/toSignal signals
  protected readonly publicPath = computed(() => `/u/${encodeURIComponent(this.username() ?? '')}`);
  protected readonly publicLink = computed(() => `${this.host()}${this.publicPath()}`);
  /** Whether the public profile is on, or `unknown` when the read failed; null until the browser has read it. */
  protected readonly state: Signal<ProfileOpenprofileState | null> = this.initState();

  public constructor() {
    afterNextRender(() => this.host.set(window.location.host));
  }

  protected openSettings(): void {
    this.visibilityDrawer.open(this.username() ?? '');
  }

  // Private initializer functions
  // Read when the page loads, and again each time the settings drawer closes, so a change saved there shows here at once.
  private initState(): Signal<ProfileOpenprofileState | null> {
    if (!isPlatformBrowser(this.platformId)) return signal(null);
    const drawerClosed$ = toObservable(this.visibilityDrawer.isOpen).pipe(
      pairwise(),
      filter(([wasOpen, isOpen]) => wasOpen && !isOpen)
    );
    return toSignal(
      drawerClosed$.pipe(
        startWith(undefined),
        switchMap(() => this.readState())
      ),
      { initialValue: null }
    );
  }

  // Private helper methods
  // A failed read claims neither state: the card offers the settings drawer, which reports its own load failure.
  private readState(): Observable<ProfileOpenprofileState> {
    return this.userService.getProfileVisibility().pipe(
      map((visibility): ProfileOpenprofileState => (visibility.isPublic ? 'public' : 'private')),
      catchError((error: unknown) => {
        console.warn('[ProfileAside] Failed to load profile visibility', error);
        return of<ProfileOpenprofileState>('unknown');
      })
    );
  }
}
