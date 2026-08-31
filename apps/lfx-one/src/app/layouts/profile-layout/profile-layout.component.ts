// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MY_CLAS_ENABLED_FLAG, normalizeTShirtSize, PENDING_PROFILE_SAVE_KEY, PROFILE_AUTH_ERROR_MESSAGES, TSHIRT_SIZES } from '@lfx-one/shared/constants';
import { CombinedProfile, EnrichedIdentity, ProfileHeaderData, ProfileTab, ProfileUpdateRequest, UserMetadata } from '@lfx-one/shared/interfaces';
import { buildProfileTabs } from '@lfx-one/shared/utils';
import { FeatureFlagService } from '@services/feature-flag.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { BehaviorSubject, catchError, EMPTY, filter, map, of, startWith, switchMap, tap } from 'rxjs';

import { stripAuthPrefixOrNull } from '@app/shared/utils/strip-auth-prefix.util';
import { ProfileEditDrawerComponent } from '../../modules/profile/components/profile-edit-drawer/profile-edit-drawer.component';
import { ProfileEditDrawerService } from '../../modules/profile/components/profile-edit-drawer/profile-edit-drawer.service';
import { ProfileVisibilityDrawerComponent } from '../../modules/profile/components/profile-visibility-drawer/profile-visibility-drawer.component';
import { ProfileVisibilityDrawerService } from '../../modules/profile/components/profile-visibility-drawer/profile-visibility-drawer.service';
import { ProfilePanelComponent } from './profile-panel/profile-panel.component';

/**
 * ProfileLayoutComponent is the shell for the Profile & Account hub. It provides:
 * - Content column: page head, subtab navigation, and the router outlet for child pages
 * - A profile rail (lfx-profile-panel) that is inline in the content column below 2xl, and a fixed,
 *   full-height 300px rail pinned to the right edge at 2xl and up — never stacks above the content,
 *   never changes width, and sits above page content (z-40) at that breakpoint; MainLayoutComponent
 *   reserves a matching right gutter (2xl and up only) so content/footer stay clear of it
 *
 * The layout owns the profile data fetch, optimistic updates, the edit drawer, and the
 * Flow C (management-token) auth-return handling; the panel is presentational and emits
 * `editRequested` back here to open the edit drawer.
 */
@Component({
  selector: 'lfx-profile-layout',
  imports: [NgClass, RouterOutlet, RouterLink, RouterLinkActive, ProfilePanelComponent, ProfileEditDrawerComponent, ProfileVisibilityDrawerComponent],
  // Drawer services are layout-scoped (not root) so their retained context is torn down when the hub
  // is left; each drawer child shares this injector instance via the providers below. MessageService
  // is deliberately NOT scoped here — the app's only <p-toast/> lives in AppComponent and reads from
  // the root MessageService, so a layout-local instance would shadow it and every toast raised by the
  // drawer/panel/visibility-drawer would be added to a MessageService no <p-toast/> ever consumes.
  providers: [ProfileEditDrawerService, ProfileVisibilityDrawerService],
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
  private readonly editDrawer = inject(ProfileEditDrawerService);
  private readonly visibilityDrawer = inject(ProfileVisibilityDrawerService);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly featureFlagService = inject(FeatureFlagService);

  // Refresh trigger for profile data
  private readonly refreshProfile$ = new BehaviorSubject<void>(undefined);

  // Store raw CombinedProfile for passing to dialog
  private combinedProfile: CombinedProfile | null = null;

  // A just-saved overlay awaiting a base profile: on the Flow C cold return the save can resolve before
  // the initial GET, so we stash it and re-apply once a GET lands (see reapplyPendingOptimisticUpdate).
  private pendingOptimisticMetadata: Partial<UserMetadata> | null = null;

  // Tab configuration. The read-only "CLAs" tab is appended (before Transactions/Settings)
  // only when the `my-clas-enabled` flag is on — matching the route's CanMatch guard.
  private readonly myClasEnabled = this.featureFlagService.getBooleanFlag(MY_CLAS_ENABLED_FLAG, false);
  public readonly tabs: Signal<ProfileTab[]> = computed(() => buildProfileTabs(this.myClasEnabled()));

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

  // Computed signals
  public readonly displayUsername = computed(() => stripAuthPrefixOrNull(this.profileData()?.username));

  // Avatar image URL: read the shared signal (uploaded avatar > Auth0 OIDC picture claim) instead
  // of this component's own profileData fetch — that GET is eventually consistent (see comment
  // above on fetchedProfileData), so after an upload elsewhere this rail must not fall back to its
  // own possibly-stale copy (LFXV2-2628).
  public readonly avatarUrl = this.userService.effectiveAvatarUrl;

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

  public readonly aboutMe = computed(() => this.profileData()?.aboutMe || '');

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

  // Connected identities — fetched once and reused for the tab notification dots and the GitHub handle
  private readonly identities: Signal<EnrichedIdentity[]> = this.initIdentities();

  // Tab notification dots — show when identities are unverified
  public readonly tabNotifications: Signal<Map<string, boolean>> = computed(() => {
    const hasUnverified = this.identities().some((id) => id.platform !== 'lfid' && id.displayState !== 'hidden' && id.displayState !== 'verified');
    return new Map<string, boolean>([['identities', hasUnverified]]);
  });

  // GitHub username from a GitHub account the user actually owns (linked in Auth0); empty otherwise.
  // inAuth0 gates out CDP-only rows (inAuth0 === false) — unverified suggestions or identities that
  // belong to another LFID merged into CDP — which could otherwise surface a stale/unowned handle.
  public readonly githubHandle: Signal<string> = computed(() => {
    const github = this.identities().find((id) => id.platform === 'github' && id.inAuth0);
    return github?.value ?? '';
  });

  public constructor() {
    // Handle Flow C return — restore saved form state and auto-save
    this.route.queryParams.pipe(takeUntilDestroyed()).subscribe((params) => {
      if (params['success'] === 'profile_token_obtained') {
        this.handleProfileAuthReturn();
        this.clearAuthQueryParams();
      }

      // hasOwn guard: params['error'] is unvalidated user input — an inherited Object.prototype
      // key (e.g. 'toString') would otherwise resolve as a truthy, non-string "message".
      const errorCode = params['error'];
      if (typeof errorCode === 'string' && Object.hasOwn(PROFILE_AUTH_ERROR_MESSAGES, errorCode)) {
        const authErrorMessage = PROFILE_AUTH_ERROR_MESSAGES[errorCode];
        // Clear any stash from the redirect that failed — otherwise it outlives this failed
        // attempt and gets replayed by the next unrelated Flow C success (see handleProfileAuthReturn).
        if (isPlatformBrowser(this.platformId)) {
          sessionStorage.removeItem(ProfileLayoutComponent.formStateKey);
        }
        this.messageService.add({
          severity: 'error',
          summary: 'Authorization Error',
          detail: authErrorMessage,
        });
        this.clearAuthQueryParams();
      }
    });
  }

  // Public methods
  public openEditDrawer(): void {
    if (!this.combinedProfile) return;
    this.editDrawer.open(this.combinedProfile);
  }

  public openVisibilityDrawer(): void {
    // The drawer fetches its own state; it only needs the username to build the public-profile URL.
    this.visibilityDrawer.open(this.displayUsername() ?? '');
  }

  /** Apply the optimistic update emitted by the edit drawer's `saved` output. */
  public onProfileSaved(metadata: Partial<UserMetadata>): void {
    this.applyOptimisticProfileUpdate(metadata);

    // Sync a fresh avatar upload into the shared signal immediately, so the home sidebar/header
    // (which read UserService.effectiveAvatarUrl, not this layout's own profileData) reflect it in
    // the same session without waiting for the next full-page load's post-hydration fetch.
    if (metadata.picture) {
      this.userService.uploadedAvatarUrl.set(metadata.picture);
    }
  }

  /**
   * Reflect a just-saved profile change immediately, without waiting on the eventually-consistent
   * profile GET. Merges the saved metadata into the cached CombinedProfile (so a reopened edit
   * drawer is correct too) and sets it as the optimistic header override.
   */
  private applyOptimisticProfileUpdate(metadata: Partial<UserMetadata>): void {
    // No base profile to merge into yet (Flow C cold load, or a user-only GET with no profile record
    // where merging would fabricate one and flip the drawer's metadataLoaded true). Stash the save +
    // refetch; reapplyPendingOptimisticUpdate merges it once a base profile lands, so an eventually-
    // consistent (pre-save) body can't mask the write.
    if (!this.combinedProfile || this.combinedProfile.profile == null) {
      this.pendingOptimisticMetadata = { ...(this.pendingOptimisticMetadata ?? {}), ...metadata };
      this.refreshProfile$.next();
      return;
    }

    // Drop `key: undefined` entries (omitted from the PATCH, so unchanged upstream) so the optimistic
    // view mirrors what was persisted. Cleared free-text fields send '' and are kept.
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
    // The merge supersedes any stash; clear it so a later GET doesn't re-apply a now-stale overlay.
    this.pendingOptimisticMetadata = null;
  }

  // After a GET populates combinedProfile, re-apply a save that was stashed because no base profile
  // existed when it resolved (Flow C cold return), so an eventually-consistent (pre-save) body can't
  // mask the write. No-op until a real profile record lands (merging a null profile would fabricate one).
  private reapplyPendingOptimisticUpdate(): void {
    const pending = this.pendingOptimisticMetadata;
    if (!pending || this.combinedProfile?.profile == null) {
      return;
    }
    this.pendingOptimisticMetadata = null;
    this.applyOptimisticProfileUpdate(pending);
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

    // Stored as one of: { savedAt, userMetadata } (drawer's mapped text-field save),
    // { savedAt, avatarPending, userMetadata? } (avatar-upload redirect, mapped and optional), or the
    // pre-LFXV2-2933 legacy { savedAt, form } (raw, no avatarPending — mapLegacyFormEnvelope below
    // preserves its original non-clearing semantics). Discard past the TTL so a stale or abandoned
    // profile-edit authorization isn't silently replayed by a later, unrelated profile-auth return.
    let userMetadata: Partial<UserMetadata> | undefined;
    let avatarPending = false;
    try {
      const envelope = JSON.parse(savedState) as {
        savedAt?: unknown;
        userMetadata?: Partial<UserMetadata>;
        form?: Partial<UserMetadata>;
        avatarPending?: boolean;
      };
      if (typeof envelope?.savedAt !== 'number' || Date.now() - envelope.savedAt > ProfileLayoutComponent.pendingSaveTtlMs) {
        return;
      }
      avatarPending = envelope.avatarPending === true;
      if (envelope.userMetadata) {
        userMetadata = envelope.userMetadata;
      } else if (envelope.form) {
        userMetadata = this.mapLegacyFormEnvelope(envelope.form);
      }
    } catch {
      return;
    }

    // The selected File can't survive the redirect (sessionStorage can't hold one), so this is the
    // earliest reliable point to tell the user to re-select their image — a toast shown right before
    // `window.location.href` in the drawer is wiped by the same-tick navigation before it can be read.
    if (avatarPending) {
      this.messageService.add({
        severity: 'info',
        summary: 'Authorization complete',
        detail: 'Please re-select your image to upload it.',
      });
    }

    if (!userMetadata) {
      return;
    }

    const updateData: ProfileUpdateRequest = {
      user_metadata: userMetadata as UserMetadata,
    };

    this.userService.updateUserProfile(updateData).subscribe({
      next: () => {
        // Optimistic update only — same as the drawer-save path. We intentionally do NOT
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

  // Legacy { savedAt, form } envelope (pre-LFXV2-2933 bundle) stored the raw form value. Map it with
  // the prior `|| undefined` omit-empties rules so a save started before a mid-Flow-C deploy replays
  // with its original (non-clearing) semantics rather than being silently dropped by the new parser.
  // Removable once no pre-2933 bundle can still be serving the write path (past the pending-save TTL).
  private mapLegacyFormEnvelope(form: Partial<UserMetadata>): Partial<UserMetadata> {
    return {
      given_name: form.given_name || undefined,
      family_name: form.family_name || undefined,
      job_title: form.job_title || undefined,
      organization: form.organization || undefined,
      country: form.country || undefined,
      state_province: form.state_province || undefined,
      city: form.city || undefined,
      address: form.address || undefined,
      postal_code: form.postal_code || undefined,
      phone_number: form.phone_number || undefined,
      t_shirt_size: form.t_shirt_size || undefined,
      bio: form.bio || undefined,
    };
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
                // Read-your-writes: if a save landed before this GET (Flow C cold return), re-apply it
                // now that combinedProfile is populated so a stale (pre-save) body can't win.
                tap(() => this.reapplyPendingOptimisticUpdate()),
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

  // Re-fetch identities on the Identities tab's refresh signal (LFXV2-2767) so the panel's GitHub
  // handle and tab-notification dots stay current without a full reload.
  private initIdentities(): Signal<EnrichedIdentity[]> {
    return toSignal(
      this.userService.identitiesRefresh$.pipe(
        startWith(undefined),
        // Drop a failed refresh (EMPTY) — the shell has no error UI, so a transient error must not
        // wipe the last-good GitHub handle / dot. initialValue covers an initial-load failure.
        switchMap(() => this.userService.getIdentities().pipe(catchError(() => EMPTY)))
      ),
      { initialValue: [] as EnrichedIdentity[] }
    );
  }

  private mapToHeaderData(profile: CombinedProfile): ProfileHeaderData {
    this.loading.set(false);
    this.combinedProfile = profile;

    // Seed the shared avatar signal from this response, with the same no-clobber guard as
    // UserService's own post-hydration fetch. This response is the profile GET itself, so unlike
    // that guard (which runs inside afterNextRender and never fires during SSR) this one also runs
    // server-side — the profile page's first render already carries the uploaded avatar instead of
    // waiting on a second, client-only fetch to correct it (LFXV2-2628).
    if (profile.profile?.picture && this.userService.uploadedAvatarUrl() === null) {
      this.userService.uploadedAvatarUrl.set(profile.profile.picture);
    }

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
      aboutMe: profile.profile?.bio || '',
    };
  }
}
