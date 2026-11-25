// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, ElementRef, inject, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  ACCOUNT_PERSONAL_INFORMATION_PATH,
  ALLOWED_AVATAR_MIME_TYPES,
  MAX_AVATAR_SIZE_BYTES,
  PENDING_PROFILE_SAVE_KEY,
  PROFILE_PAGE_COPY,
} from '@lfx-one/shared/constants';
import { EnrichedIdentity, PendingProfileSave } from '@lfx-one/shared/interfaces';
import { formatMemberSinceDate } from '@lfx-one/shared/utils';
import { AccountProfileService } from '@services/account-profile.service';
import { ProfileAuthReturnService } from '@services/profile-auth-return.service';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { stripAuthPrefixOrNull } from '@shared/utils/strip-auth-prefix.util';
import { catchError, distinctUntilChanged, EMPTY, finalize, of, startWith, switchMap } from 'rxjs';

/**
 * The Profile page (#6082), behind the profile redesign flag: a hero with the photo, name, role and bio. Every edit happens on
 * Account & Settings › Personal information, except a new photo, which uploads from the hero as it does there.
 */
@Component({
  selector: 'lfx-profile-page',
  imports: [UiButtonComponent],
  // The page owns its profile and, for a photo upload that left for authorization, the Flow C return.
  providers: [AccountProfileService, ProfileAuthReturnService],
  templateUrl: './profile-page.component.html',
})
export class ProfilePageComponent {
  // Private injections
  private readonly accountProfile = inject(AccountProfileService);
  private readonly authReturn = inject(ProfileAuthReturnService);
  private readonly userService = inject(UserService);
  private readonly toast = inject(UiToastService);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly avatarInput = viewChild<ElementRef<HTMLInputElement>>('avatarInput');

  protected readonly copy = PROFILE_PAGE_COPY;
  protected readonly personalInformationPath = ACCOUNT_PERSONAL_INFORMATION_PATH;
  protected readonly avatarAccept = ALLOWED_AVATAR_MIME_TYPES.join(',');

  // Simple WritableSignals
  protected readonly avatarUploading = signal(false);

  // Complex computed/toSignal signals
  protected readonly profile = this.accountProfile.profile;
  protected readonly impersonating = this.userService.impersonating;
  protected readonly avatarUrl = this.userService.effectiveAvatarUrl;
  protected readonly name: Signal<string> = this.initName();
  protected readonly jobTitle = computed(() => this.profile()?.profile?.job_title?.trim() ?? '');
  protected readonly company = computed(() => this.profile()?.profile?.organization?.trim() ?? '');
  protected readonly location = computed(() => [this.profile()?.profile?.city, this.profile()?.profile?.country].filter((part) => !!part?.trim()).join(', '));
  protected readonly bio = computed(() => this.profile()?.profile?.bio?.trim() ?? '');
  protected readonly memberSince = computed(() => formatMemberSinceDate(this.profile()?.user.created_at));
  protected readonly companyLogo: Signal<string | null> = this.initCompanyLogo();
  protected readonly githubHandle: Signal<string> = this.initGithubHandle();
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
    if (!file || this.impersonating()) return;

    if (!(ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
      this.toast.show({ variant: 'error', message: this.copy.photoType });
      return;
    }
    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      this.toast.show({ variant: 'error', message: this.copy.photoSize });
      return;
    }

    this.avatarUploading.set(true);
    // Not tied to the page: the upload is what the user asked for, so leaving must not drop it. The service takes one value.
    this.userService
      .uploadProfilePicture(file)
      .pipe(finalize(() => this.avatarUploading.set(false)))
      .subscribe({
        next: (response) => {
          if (!response.public_url) {
            this.toast.show({ variant: 'error', message: this.copy.photoFailed });
            return;
          }
          this.accountProfile.applySaved({ picture: response.public_url });
          this.toast.show({ variant: 'dark', message: this.copy.photoUpdated });
        },
        error: (error: HttpErrorResponse) => this.onAvatarUploadError(error),
      });
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
        switchMap(() => this.userService.getIdentities().pipe(catchError(() => EMPTY)))
      ),
      { initialValue: [] as EnrichedIdentity[] }
    );
    return computed(() => identities().find((identity) => identity.platform === 'github' && identity.inAuth0)?.value ?? '');
  }

  // Private helper methods
  private onAvatarUploadError(error: HttpErrorResponse): void {
    // Flow C: a File can't survive the redirect, so the page asks for the photo again once the user is back.
    if (error.status === 403 && error.error?.error === 'management_token_required') {
      if (isPlatformBrowser(this.platformId)) {
        sessionStorage.setItem(PENDING_PROFILE_SAVE_KEY, JSON.stringify({ savedAt: Date.now(), avatarPending: true } satisfies PendingProfileSave));
        window.location.assign(error.error.authorize_url);
      }
      return;
    }
    if (error.status === 403 && error.error?.code === 'IMPERSONATION_READ_ONLY') {
      this.toast.show({ variant: 'error', message: this.copy.photoImpersonating });
      return;
    }
    this.toast.show({ variant: 'error', message: this.copy.photoFailed });
  }
}
