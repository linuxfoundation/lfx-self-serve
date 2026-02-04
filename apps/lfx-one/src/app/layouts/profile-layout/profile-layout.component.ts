// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { CardComponent } from '@components/card/card.component';
import { SelectComponent } from '@components/select/select.component';
import { PROFILE_TABS } from '@lfx-one/shared/constants';
import { CombinedProfile, ProfileHeaderData, ProfileTab } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { catchError, filter, map, of, switchMap } from 'rxjs';

/**
 * ProfileLayoutComponent serves as the shell for all profile pages.
 * It provides:
 * - Profile header card with user info
 * - Tab navigation (horizontal on desktop, dropdown on mobile)
 * - Router outlet for child components
 */
@Component({
  selector: 'lfx-profile-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ReactiveFormsModule, CardComponent, AvatarComponent, SelectComponent],
  templateUrl: './profile-layout.component.html',
  styleUrl: './profile-layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileLayoutComponent {
  // Private injections
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly fb = inject(NonNullableFormBuilder);

  // Tab configuration
  public readonly tabs: ProfileTab[] = PROFILE_TABS;

  // Tab options for dropdown (mobile)
  public readonly tabOptions = this.tabs.map((tab) => ({
    label: tab.label,
    value: tab.route,
  }));

  // Form for mobile tab selection
  public readonly tabForm = this.fb.group({
    selectedTab: ['overview'],
  });

  // Profile data from service
  public readonly profileData: Signal<ProfileHeaderData | null> = this.initProfileData();

  // Loading state
  public readonly loading = signal<boolean>(true);

  // Computed signals
  public readonly displayName = computed(() => {
    const data = this.profileData();
    if (!data) return '';
    return `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.username || 'User';
  });

  public readonly initials = computed(() => {
    const data = this.profileData();
    if (!data) return 'U';
    const first = data.firstName?.charAt(0).toUpperCase() || '';
    const last = data.lastName?.charAt(0).toUpperCase() || '';
    return first + last || data.username?.charAt(0).toUpperCase() || 'U';
  });

  public readonly jobInfo = computed(() => {
    const data = this.profileData();
    if (!data) return '';
    const parts = [data.jobTitle, data.organization].filter(Boolean);
    return parts.join(' at ');
  });

  public readonly locationInfo = computed(() => {
    const data = this.profileData();
    if (!data) return '';
    const parts = [data.city, data.stateProvince, data.country].filter(Boolean);
    return parts.join(', ');
  });

  public constructor() {
    // Subscribe to tab selection changes for mobile navigation
    this.tabForm.controls.selectedTab.valueChanges.pipe(takeUntilDestroyed()).subscribe((route) => {
      if (route) {
        this.router.navigate(['/profile', route]);
      }
    });
  }

  // Private init functions
  private initProfileData(): Signal<ProfileHeaderData | null> {
    return toSignal(
      toObservable(this.userService.user).pipe(
        filter((user) => user !== null),
        switchMap(() =>
          this.userService.getCurrentUserProfile().pipe(
            map((profile: CombinedProfile) => this.mapToHeaderData(profile)),
            catchError(() => of(null))
          )
        )
      ),
      { initialValue: null }
    );
  }

  private mapToHeaderData(profile: CombinedProfile): ProfileHeaderData {
    this.loading.set(false);
    return {
      firstName: profile.user.first_name || '',
      lastName: profile.user.last_name || '',
      username: profile.user.username || '',
      jobTitle: profile.profile?.job_title || '',
      organization: profile.profile?.organization || '',
      city: profile.profile?.city || '',
      stateProvince: profile.profile?.state_province || '',
      country: profile.profile?.country || '',
      avatarUrl: profile.profile?.picture || '',
    };
  }
}
