// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, ElementRef, inject, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  ACCOUNT_IDENTITIES_PATH,
  ACCOUNT_PERSONAL_INFORMATION_PATH,
  ALLOWED_AVATAR_MIME_TYPES,
  IMPERSONATION_BANNER_HEIGHT_PX,
  PENDING_PROFILE_SAVE_KEY,
  PROFILE_ASIDE_COPY,
  PROFILE_ASIDE_MEDIA_QUERY,
  PROFILE_NO_ACTIVITY_COPY,
  PROFILE_PAGE_COPY,
} from '@lfx-one/shared/constants';
import { EnrichedIdentity, PendingProfileSave } from '@lfx-one/shared/interfaces';
import { formatMemberSinceDate } from '@lfx-one/shared/utils';
import { AccountProfileService } from '@services/account-profile.service';
import { ProfileAuthReturnService } from '@services/profile-auth-return.service';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { injectMediaQueryMatches } from '@shared/utils/mobile-viewport.util';
import { stripAuthPrefixOrNull } from '@shared/utils/strip-auth-prefix.util';
import { catchError, distinctUntilChanged, EMPTY, of, startWith, switchMap } from 'rxjs';

import { ProfileVisibilityDrawerComponent } from '../components/profile-visibility-drawer/profile-visibility-drawer.component';
import { ProfileVisibilityDrawerService } from '../components/profile-visibility-drawer/profile-visibility-drawer.service';
import { ProfileAsideComponent } from './profile-aside/profile-aside.component';
import { ProfileGroupsComponent } from './profile-groups/profile-groups.component';
import { ProfileInvolvementComponent } from './profile-involvement/profile-involvement.component';
import { ProfileRecognitionsComponent } from './profile-recognitions/profile-recognitions.component';

/**
 * The Profile page (#6082), behind the profile redesign flag: a hero with the photo, name, role and bio. Every edit happens on
 * Account & Settings › Personal information, except a new photo, which uploads from the hero as it does there.
 */
@Component({
  selector: 'lfx-profile-page',
  // Cancels the main layout's page padding: the page sets its own gutters.
  host: { class: 'block -mx-5 md:-mx-8' },
  imports: [
    UiButtonComponent,
    UiNoteComponent,
    ProfileAsideComponent,
    ProfileRecognitionsComponent,
    ProfileInvolvementComponent,
    ProfileGroupsComponent,
    ProfileVisibilityDrawerComponent,
  ],
  // The page owns its profile, the Flow C return for a photo upload that left for authorization, and the Open Profile drawer.
  providers: [AccountProfileService, ProfileAuthReturnService, ProfileVisibilityDrawerService],
  templateUrl: './profile-page.component.html',
})
export class ProfilePageComponent {
  // Private injections
  private readonly accountProfile = inject(AccountProfileService);
  private readonly authReturn = inject(ProfileAuthReturnService);
  private readonly userService = inject(UserService);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly avatarInput = viewChild<ElementRef<HTMLInputElement>>('avatarInput');

  protected readonly copy = PROFILE_PAGE_COPY;
  protected readonly personalInformationPath = ACCOUNT_PERSONAL_INFORMATION_PATH;
  protected readonly avatarAccept = ALLOWED_AVATAR_MIME_TYPES.join(',');
  protected readonly railLabel = PROFILE_ASIDE_COPY.railLabel;
  protected readonly noActivityCopy = PROFILE_NO_ACTIVITY_COPY;
  protected readonly identitiesPath = ACCOUNT_IDENTITIES_PATH;

  // Simple WritableSignals
  /** Each section's answer to "is it empty?": null until it has loaded. */
  protected readonly recognitionsEmpty = signal<boolean | null>(null);
  protected readonly involvementEmpty = signal<boolean | null>(null);
  protected readonly groupsEmpty = signal<boolean | null>(null);

  // Complex computed/toSignal signals
  protected readonly profile = this.accountProfile.profile;
  protected readonly profileFailed = this.accountProfile.failed;
  protected readonly avatarUploading = this.accountProfile.avatarUploading;
  protected readonly impersonating = this.userService.impersonating;
  // A photo uploaded this session first, then the one this page loaded, then the sign-in picture.
  protected readonly avatarUrl = computed(
    () => this.userService.uploadedAvatarUrl() || this.profile()?.profile?.picture || this.userService.effectiveAvatarUrl()
  );
  // The empty-field prompts wait for a stored record: a failed metadata read also comes back without one.
  protected readonly recordLoaded = computed(() => this.profile()?.profile != null);
  protected readonly name: Signal<string> = this.initName();
  // The openprofile rail's media query, followed once the browser renders so SSR and hydration agree (#6083).
  protected readonly railShown = injectMediaQueryMatches(PROFILE_ASIDE_MEDIA_QUERY);
  /** Every section loaded and empty: the page asks for the emails and accounts that would bring in the user's work. */
  protected readonly noActivity = computed(() => this.recognitionsEmpty() === true && this.involvementEmpty() === true && this.groupsEmpty() === true);
  protected readonly railTop = computed(() => (this.impersonating() ? IMPERSONATION_BANNER_HEIGHT_PX : 0));
  // Null while the profile is still loading, so the rail holds its placeholder; '' when none came back.
  protected readonly username = computed<string | null>(() => {
    const profile = this.profile();
    if (!profile) return this.profileFailed() ? '' : null;
    return stripAuthPrefixOrNull(profile.user.username) ?? '';
  });
  protected readonly jobTitle = computed(() => this.profile()?.profile?.job_title?.trim() ?? '');
  protected readonly company = computed(() => this.profile()?.profile?.organization?.trim() ?? '');
  protected readonly location = computed(() => [this.profile()?.profile?.city, this.profile()?.profile?.country].filter((part) => !!part?.trim()).join(', '));
  protected readonly bio = computed(() => this.profile()?.profile?.bio?.trim() ?? '');
  protected readonly memberSince = computed(() => formatMemberSinceDate(this.profile()?.user.created_at));
  protected readonly companyLogo: Signal<string | null> = this.initCompanyLogo();
  protected readonly githubHandle: Signal<string> = this.initGithubHandle();
  protected readonly githubUrl = computed(() => `https://github.com/${encodeURIComponent(this.githubHandle())}`);
  protected readonly avatarUploadLabel = computed(() => (this.avatarUrl() ? this.copy.uploadNewPhoto : this.copy.uploadPhoto));

  public constructor() {
    this.accountProfile.load();
    // Flow C return from a photo upload: nothing is replayed but the prompt to pick the photo again.
    this.authReturn.listen((metadata) => this.accountProfile.applySaved(metadata));
  }

  /** Opens the file picker through the hidden input, so the trigger stays a real button. */
  protected triggerAvatarUpload(): void {
    this.avatarInput()?.nativeElement.click();
  }

  protected onAvatarFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Cleared so choosing the same file again, after a rejected upload, still fires change.
    input.value = '';
    if (!file) return;
    // Flow C: a File can't survive the redirect, so the page asks for the photo again once the user is back.
    this.accountProfile.uploadAvatar(file, (authorizeUrl) => {
      if (!isPlatformBrowser(this.platformId)) return;
      sessionStorage.setItem(PENDING_PROFILE_SAVE_KEY, JSON.stringify({ savedAt: Date.now(), avatarPending: true } satisfies PendingProfileSave));
      window.location.assign(authorizeUrl);
    });
  }

  protected retryProfile(): void {
    this.accountProfile.load();
  }

  // Private initializer functions
  private initName(): Signal<string> {
    return computed(() => {
      const user = this.profile()?.user;
      // The session's name stands in until the profile loads, or when it fails to.
      if (!user) return this.userService.user()?.name ?? '';
      return `${user.first_name || ''} ${user.last_name || ''}`.trim() || stripAuthPrefixOrNull(user.username) || 'User';
    });
  }

  // The company's logo from the matching work-history entry; none while it loads, or when nothing matches.
  private initCompanyLogo(): Signal<string | null> {
    return toSignal(
      toObservable(this.company).pipe(
        distinctUntilChanged(),
        switchMap((company) => (company && isPlatformBrowser(this.platformId) ? this.userService.getWorkHistoryLogo(company) : of(null)))
      ),
      { initialValue: null }
    );
  }

  // A GitHub account the user owns (linked in Auth0), as the hub shows it. Browser only, like the hub: an SSR fetch would re-run the
  // server's identity reconcile alongside the browser's (#4523).
  private initGithubHandle(): Signal<string> {
    if (!isPlatformBrowser(this.platformId)) return signal('');
    const identities = toSignal(
      this.userService.identitiesRefresh$.pipe(
        startWith(undefined),
        // A failed refresh keeps the last handle; the hero has no error state for a link it can leave out.
        switchMap(() =>
          this.userService.getIdentities().pipe(
            catchError((error: unknown) => {
              console.warn('[ProfilePage] Failed to load identities; leaving the GitHub link out', error);
              return EMPTY;
            })
          )
        )
      ),
      { initialValue: [] as EnrichedIdentity[] }
    );
    return computed(() => identities().find((identity) => identity.platform === 'github' && identity.inAuth0)?.value ?? '');
  }
}
