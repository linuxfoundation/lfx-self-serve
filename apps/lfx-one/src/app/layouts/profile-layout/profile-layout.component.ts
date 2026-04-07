// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SelectComponent } from '@components/select/select.component';
import { PROFILE_TABS, TSHIRT_SIZES } from '@lfx-one/shared/constants';
import { CombinedProfile, ProfileHeaderData, ProfileTab, ProfileUpdateRequest, UserMetadata } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { BehaviorSubject, catchError, combineLatest, filter, map, of, startWith, switchMap, take } from 'rxjs';

import { ProfileEditDialogComponent } from '../../modules/profile/components/profile-edit-dialog/profile-edit-dialog.component';

/**
 * ProfileLayoutComponent serves as the shell for all profile pages.
 * It provides:
 * - Profile header card with user info
 * - Tab navigation (horizontal on desktop, dropdown on mobile)
 * - Router outlet for child components
 */
@Component({
  selector: 'lfx-profile-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ReactiveFormsModule, SelectComponent],
  providers: [DialogService, MessageService],
  templateUrl: './profile-layout.component.html',
  styleUrl: './profile-layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileLayoutComponent {
  private static readonly formStateKey = 'lfx_profile_pending_save';

  // Private injections
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);

  // Refresh trigger for profile data
  private readonly refreshProfile$ = new BehaviorSubject<void>(undefined);

  // Store raw CombinedProfile for passing to dialog
  private combinedProfile: CombinedProfile | null = null;

  // Tab configuration
  public readonly tabs: ProfileTab[] = PROFILE_TABS;

  // Tab options for dropdown (mobile)
  public readonly tabOptions = this.tabs.map((tab) => ({
    label: tab.label,
    value: tab.route,
  }));

  // Form for mobile tab selection
  public readonly tabForm = this.fb.group({
    selectedTab: ['attribution'],
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
    return data.firstName?.charAt(0).toUpperCase() || data.username?.charAt(0).toUpperCase() || 'U';
  });

  public readonly jobTitle = computed(() => this.profileData()?.jobTitle || '');

  public readonly organization = computed(() => this.profileData()?.organization || '');

  public readonly emailInfo = computed(() => this.profileData()?.email || '');

  public readonly fullAddress: Signal<string[]> = this.initFullAddress();

  public readonly phoneInfo = computed(() => {
    const data = this.profileData();
    return data?.phoneNumber || '';
  });

  public readonly tshirtSizeLabel = computed(() => {
    const data = this.profileData();
    if (!data?.tshirtSize) return '';
    const match = TSHIRT_SIZES.find((s) => s.value === data.tshirtSize);
    return match?.label || data.tshirtSize;
  });

  // Tab notification dots — show when work experiences need review or identities are unverified
  public readonly tabNotifications: Signal<Map<string, boolean>> = this.initTabNotifications();

  public constructor() {
    // Subscribe to tab selection changes for mobile navigation
    this.tabForm.controls.selectedTab.valueChanges.pipe(takeUntilDestroyed()).subscribe((route) => {
      if (route) {
        this.router.navigate(['/profile', route]);
      }
    });

    // Sync mobile dropdown when route changes (back/forward, direct URL)
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe((event) => {
        const match = event.urlAfterRedirects.match(/\/profile\/([^?/]+)/);
        if (match) {
          this.tabForm.controls.selectedTab.setValue(match[1], { emitEvent: false });
        }
      });

    // Handle Flow C return — restore saved form state and auto-save
    this.route.queryParams.pipe(takeUntilDestroyed()).subscribe((params) => {
      if (params['success'] === 'profile_token_obtained') {
        this.handleProfileAuthReturn();
        this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
      }

      if (params['error']) {
        this.messageService.add({
          severity: 'error',
          summary: 'Authorization Error',
          detail: 'Profile authorization failed. Please try saving again.',
        });
        this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
      }
    });
  }

  // Public methods
  public openEditDialog(): void {
    if (!this.combinedProfile) return;

    const dialogRef = this.dialogService.open(ProfileEditDialogComponent, {
      header: 'Edit Profile',
      width: '900px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: { combinedProfile: this.combinedProfile },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result: boolean | null) => {
      if (result) {
        this.refreshProfile$.next();
      }
    });
  }

  /**
   * After returning from Flow C authorization, restore saved form state and auto-save
   */
  private handleProfileAuthReturn(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const savedState = sessionStorage.getItem(ProfileLayoutComponent.formStateKey);
    if (!savedState) {
      return;
    }

    sessionStorage.removeItem(ProfileLayoutComponent.formStateKey);

    let formData: Partial<UserMetadata>;
    try {
      formData = JSON.parse(savedState);
    } catch {
      return;
    }
    const userMetadata: Partial<UserMetadata> = {
      given_name: formData.given_name || undefined,
      family_name: formData.family_name || undefined,
      job_title: formData.job_title || undefined,
      organization: formData.organization || undefined,
      country: formData.country || undefined,
      state_province: formData.state_province || undefined,
      city: formData.city || undefined,
      address: formData.address || undefined,
      postal_code: formData.postal_code || undefined,
      phone_number: formData.phone_number || undefined,
      t_shirt_size: formData.t_shirt_size || undefined,
    };

    const updateData: ProfileUpdateRequest = {
      user_metadata: userMetadata as UserMetadata,
    };

    this.userService.updateUserProfile(updateData).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Profile updated successfully!',
        });
        this.refreshProfile$.next();
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to save profile. Please try again.',
        });
      },
    });
  }

  // Private init functions
  private initProfileData(): Signal<ProfileHeaderData | null> {
    const user$ = toObservable(this.userService.user);
    return toSignal(
      this.refreshProfile$.pipe(
        switchMap(() =>
          user$.pipe(
            filter((user) => user !== null),
            switchMap(() =>
              this.userService.getCurrentUserProfile().pipe(
                map((profile: CombinedProfile) => this.mapToHeaderData(profile)),
                catchError(() => of(null))
              )
            )
          )
        )
      ),
      { initialValue: null }
    );
  }

  private initFullAddress(): Signal<string[]> {
    return computed(() => {
      const data = this.profileData();
      if (!data) return [];
      const lines: string[] = [];
      if (data.address) {
        lines.push(data.address);
      }
      const cityStateParts = [data.city, data.stateProvince, data.postalCode].filter(Boolean);
      if (cityStateParts.length > 0) {
        const cityState = [data.city, data.stateProvince].filter(Boolean).join(', ');
        lines.push(data.postalCode ? `${cityState} ${data.postalCode}`.trim() : cityState);
      }
      if (data.country) {
        lines.push(data.country);
      }
      return lines;
    });
  }

  private initTabNotifications(): Signal<Map<string, boolean>> {
    return toSignal(
      combineLatest([
        this.userService.getWorkExperiences().pipe(
          map((entries) => entries.some((e) => e.needsReview)),
          catchError(() => of(false)),
          startWith(false)
        ),
        this.userService.getIdentities().pipe(
          map((identities) => identities.some((id) => id.platform !== 'lfid' && id.displayState !== 'hidden' && id.displayState !== 'verified')),
          catchError(() => of(false)),
          startWith(false)
        ),
      ]).pipe(
        map(([hasReviewable, hasUnverified]) => {
          const notifications = new Map<string, boolean>();
          notifications.set('attribution', hasReviewable);
          notifications.set('identities', hasUnverified);
          return notifications;
        })
      ),
      { initialValue: new Map<string, boolean>() }
    );
  }

  private mapToHeaderData(profile: CombinedProfile): ProfileHeaderData {
    this.loading.set(false);
    this.combinedProfile = profile;
    return {
      firstName: profile.user.first_name || '',
      lastName: profile.user.last_name || '',
      username: profile.user.username || '',
      email: profile.user.email || '',
      jobTitle: profile.profile?.job_title || '',
      organization: profile.profile?.organization || '',
      city: profile.profile?.city || '',
      stateProvince: profile.profile?.state_province || '',
      country: profile.profile?.country || '',
      address: profile.profile?.address || '',
      postalCode: profile.profile?.postal_code || '',
      phoneNumber: profile.profile?.phone_number || '',
      tshirtSize: profile.profile?.t_shirt_size || '',
      avatarUrl: profile.profile?.picture || '',
    };
  }
}
