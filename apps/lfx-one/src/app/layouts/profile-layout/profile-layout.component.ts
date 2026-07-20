// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SelectComponent } from '@components/select/select.component';
import { normalizeTShirtSize, PENDING_PROFILE_SAVE_KEY, PROFILE_TABS, TSHIRT_SIZES } from '@lfx-one/shared/constants';
import { CombinedProfile, ProfileHeaderData, ProfileTab, ProfileUpdateRequest, UserMetadata } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { BehaviorSubject, catchError, filter, map, of, startWith, switchMap, take } from 'rxjs';

import { stripAuthPrefixOrNull } from '@app/shared/utils/strip-auth-prefix.util';
import { ProfileEditDialogComponent } from '../../modules/profile/components/profile-edit-dialog/profile-edit-dialog.component';

// Error codes that originate from the Flow C profile-auth (/passwordless/callback) flow.
// Child routes (e.g. identities) handle their own error codes — do not swallow them here.
const PROFILE_AUTH_ERROR_CODES = new Set([
  'profile_auth_not_configured',
  'profile_auth_failed',
  'token_exchange_failed',
  'login_session_invalid',
  'user_mismatch',
]);

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
  private static readonly formStateKey = PENDING_PROFILE_SAVE_KEY;
  // Discard a stored pending-save older than this. Prevents an abandoned profile-edit authorization
  // from being silently replayed by a later, unrelated profile-auth return (e.g. an email-delete
  // authorization that now lands on /profile/settings inside this shell).
  private static readonly pendingSaveTtlMs = 10 * 60 * 1000;

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
    selectedTab: ['attributions'],
  });

  // Profile data from the service (server-fetched). The profile GET is eventually consistent
  // (read-after-write lag in the auth-service), so after a save we apply an optimistic override
  // that takes precedence — otherwise an immediate refetch can return the pre-save body.
  private readonly fetchedProfileData: Signal<ProfileHeaderData | null> = this.initProfileData();
  private readonly optimisticProfileData = signal<ProfileHeaderData | null>(null);
  public readonly profileData: Signal<ProfileHeaderData | null> = computed(() => this.optimisticProfileData() ?? this.fetchedProfileData());

  // Loading state
  public readonly loading = signal<boolean>(true);

  // When impersonating, the profile is shown read-only: the profile GET reflects the target user,
  // but all profile mutations act on the real user's account server-side and are blocked. The edit
  // affordances render visible-but-disabled and a banner surfaces the read-only state.
  public readonly impersonating = this.userService.impersonating;

  // Tracks failed avatar image loads so we can fall back to initials
  public readonly avatarLoadError = signal<boolean>(false);

  // Computed signals
  public readonly displayUsername = computed(() => stripAuthPrefixOrNull(this.profileData()?.username));

  // Avatar image URL sourced from auth0 user_metadata.picture (empty when unset)
  public readonly avatarUrl = computed(() => this.profileData()?.avatarUrl || '');

  public readonly displayName = computed(() => {
    const data = this.profileData();
    if (!data) return '';
    const cleanUsername = stripAuthPrefixOrNull(data.username);
    return `${data.firstName || ''} ${data.lastName || ''}`.trim() || cleanUsername || 'User';
  });

  public readonly initials = computed(() => {
    const data = this.profileData();
    if (!data) return 'U';
    const cleanUsername = stripAuthPrefixOrNull(data.username);
    return data.firstName?.charAt(0).toUpperCase() || cleanUsername?.charAt(0).toUpperCase() || 'U';
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
    // Reset the avatar error flag whenever the picture URL changes so a newly-set
    // (or refreshed) avatar re-attempts to load instead of staying on the initials fallback
    effect(() => {
      this.avatarUrl();
      this.avatarLoadError.set(false);
    });

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
        this.clearAuthQueryParams();
      }

      if (PROFILE_AUTH_ERROR_CODES.has(params['error'])) {
        this.messageService.add({
          severity: 'error',
          summary: 'Authorization Error',
          detail: 'Authorization failed. Please try again.',
        });
        this.clearAuthQueryParams();
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

    dialogRef.onClose.pipe(take(1)).subscribe((result: Partial<UserMetadata> | null) => {
      if (result) {
        this.applyOptimisticProfileUpdate(result);
      }
    });
  }

  /**
   * Reflect a just-saved profile change immediately, without waiting on the eventually-consistent
   * profile GET. Merges the saved metadata into the cached CombinedProfile (so a reopened edit
   * dialog is correct too) and sets it as the optimistic header override.
   */
  private applyOptimisticProfileUpdate(metadata: Partial<UserMetadata>): void {
    if (!this.combinedProfile) {
      // No base profile to merge into yet (e.g. Flow C cold load, where the save resolves before
      // the initial profile GET populates combinedProfile). Fall back to a refetch so the UI still
      // reflects the change — there's nothing cached to clobber in this case.
      this.refreshProfile$.next();
      return;
    }

    // The dialog builds metadata with `key: undefined` for empty fields; those keys are omitted
    // from the PATCH body, so the backend leaves them unchanged. Drop them here too — otherwise the
    // optimistic view would clear fields that were never actually persisted as cleared.
    const definedMetadata = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)) as Partial<UserMetadata>;

    const mergedProfile: CombinedProfile = {
      ...this.combinedProfile,
      user: {
        ...this.combinedProfile.user,
        // user.first_name / last_name are derived from given_name / family_name server-side
        first_name: definedMetadata.given_name ?? this.combinedProfile.user.first_name,
        last_name: definedMetadata.family_name ?? this.combinedProfile.user.last_name,
      },
      profile: {
        ...this.combinedProfile.profile,
        ...definedMetadata,
      },
    };

    this.combinedProfile = mergedProfile;
    this.optimisticProfileData.set(this.mapToHeaderData(mergedProfile));
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

    // Stored as { savedAt, form }. Discard if older than the TTL so an abandoned profile-edit
    // authorization isn't silently replayed by a later, unrelated profile-auth return.
    let formData: Partial<UserMetadata>;
    try {
      const envelope = JSON.parse(savedState) as { savedAt?: unknown; form?: Partial<UserMetadata> };
      if (typeof envelope?.savedAt !== 'number' || !envelope.form || Date.now() - envelope.savedAt > ProfileLayoutComponent.pendingSaveTtlMs) {
        return;
      }
      formData = envelope.form;
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
        // Optimistic update only — same as the dialog-close path. We intentionally do NOT
        // refresh here: the profile GET is eventually consistent, so an immediate refetch could
        // overwrite combinedProfile with the pre-save body and reintroduce stale-on-reopen.
        this.applyOptimisticProfileUpdate(userMetadata);
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Profile updated successfully!',
        });
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

  // Strip the Flow C query params (success/error) while staying on the current tab.
  // Navigating relative to this.route would resolve to the parent /profile route and
  // bounce the user to the default tab — so re-navigate to the current path sans query.
  private clearAuthQueryParams(): void {
    const path = this.router.url.split('?')[0];
    this.router.navigateByUrl(path, { replaceUrl: true });
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
      this.userService.getIdentities().pipe(
        map((identities) => identities.some((id) => id.platform !== 'lfid' && id.displayState !== 'hidden' && id.displayState !== 'verified')),
        catchError(() => of(false)),
        startWith(false),
        map((hasUnverified) => {
          const notifications = new Map<string, boolean>();
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
      tshirtSize: normalizeTShirtSize(profile.profile?.t_shirt_size),
      avatarUrl: profile.profile?.picture || '',
    };
  }
}
