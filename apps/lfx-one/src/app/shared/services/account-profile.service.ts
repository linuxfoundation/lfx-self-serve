// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ALLOWED_AVATAR_MIME_TYPES, AVATAR_UPLOAD_COPY, MAX_AVATAR_SIZE_BYTES } from '@lfx-one/shared/constants';
import { CombinedProfile, UserMetadata } from '@lfx-one/shared/interfaces';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { catchError, finalize, of, Subject, switchMap } from 'rxjs';

import { ProfileSavedFieldsService } from './profile-saved-fields.service';
import { ProfileSaveSyncService } from './profile-save-sync.service';
import { UserService } from './user.service';

/**
 * The signed-in user's profile for Account & Settings (#6072), provided by the shell so a save replayed after a Flow C return
 * reaches the Personal information page. The profile GET is eventually consistent, so every save is kept and laid over each
 * fetch; otherwise a refetch straight after a save could show the values from before it.
 */
@Injectable()
export class AccountProfileService {
  private readonly userService = inject(UserService);
  private readonly saveSync = inject(ProfileSaveSyncService);
  private readonly toast = inject(UiToastService);

  private readonly load$ = new Subject<void>();
  private readonly fetched = signal<CombinedProfile | null>(null);
  private readonly savedFieldsStore = inject(ProfileSavedFieldsService);

  public readonly loading = signal(false);
  public readonly failed = signal(false);
  public readonly avatarUploading = signal(false);
  /** Every field saved this session, newest value each, shared app-wide so the Profile page shows saves made here (#6082). */
  public readonly savedFields: Signal<Partial<UserMetadata>> = this.savedFieldsStore.fields;
  /** The fetched profile with every save made since laid over it; `null` until the first fetch lands. */
  public readonly profile: Signal<CombinedProfile | null> = computed(() => this.withSaves(this.fetched(), this.savedFields()));

  public constructor() {
    this.load$
      .pipe(
        switchMap(() => {
          this.loading.set(true);
          this.failed.set(false);
          return this.userService.getCurrentUserProfile().pipe(
            catchError((error: unknown) => {
              console.error('Failed to load the profile for Account & Settings:', error);
              this.failed.set(true);
              return of(null);
            }),
            finalize(() => this.loading.set(false))
          );
        }),
        takeUntilDestroyed(inject(DestroyRef))
      )
      .subscribe((profile) => {
        if (profile) this.fetched.set(profile);
      });
  }

  /** Fetches the profile again; a fetch still in flight is dropped. */
  public load(): void {
    this.load$.next();
  }

  /** Records a save so the profile shows it at once, and carries it to the navbar, avatar and Mentorship. */
  public applySaved(metadata: Partial<UserMetadata>): void {
    this.saveSync.apply(metadata, this.profile()?.user);
    this.savedFieldsStore.record(metadata);
    // A save creates the record the last fetch lacked, so fetch it; the saves stay laid over the response.
    if (this.fetched() && this.fetched()?.profile == null) this.load();
  }

  /**
   * Uploads a new profile picture and shows it at once, reporting a rejected file or a failure in a toast. Nothing happens while
   * impersonating. When the change needs Flow C authorization, `authorize` gets the URL to leave for instead.
   */
  public uploadAvatar(file: File, authorize: (authorizeUrl: string) => void): void {
    if (this.userService.impersonating()) return;
    if (!(ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
      this.toast.show({ variant: 'error', message: AVATAR_UPLOAD_COPY.wrongType });
      return;
    }
    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      this.toast.show({ variant: 'error', message: AVATAR_UPLOAD_COPY.tooLarge });
      return;
    }

    this.avatarUploading.set(true);
    // Not tied to a page: the upload is what the user asked for, so leaving must not drop it. The service takes one value.
    this.userService
      .uploadProfilePicture(file)
      .pipe(finalize(() => this.avatarUploading.set(false)))
      .subscribe({
        next: (response) => {
          if (!response.public_url) {
            this.toast.show({ variant: 'error', message: AVATAR_UPLOAD_COPY.failed });
            return;
          }
          this.applySaved({ picture: response.public_url });
          this.toast.show({ variant: 'dark', message: AVATAR_UPLOAD_COPY.updated });
        },
        error: (error: HttpErrorResponse) => this.onAvatarUploadError(error, authorize),
      });
  }

  // With no profile record yet, laying saves over it would invent one, so they wait for a fetch that has a record.
  private withSaves(profile: CombinedProfile | null, saved: Partial<UserMetadata>): CombinedProfile | null {
    if (!profile || profile.profile == null || Object.keys(saved).length === 0) return profile;
    return {
      ...profile,
      // first_name and last_name are derived from given_name and family_name server-side.
      user: { ...profile.user, first_name: saved.given_name ?? profile.user.first_name, last_name: saved.family_name ?? profile.user.last_name },
      profile: { ...profile.profile, ...saved },
    };
  }

  private onAvatarUploadError(error: HttpErrorResponse, authorize: (authorizeUrl: string) => void): void {
    const authorizeUrl = error.error?.authorize_url;
    if (error.status === 403 && error.error?.error === 'management_token_required' && typeof authorizeUrl === 'string' && authorizeUrl) {
      authorize(authorizeUrl);
      return;
    }
    const impersonating = error.status === 403 && error.error?.code === 'IMPERSONATION_READ_ONLY';
    this.toast.show({ variant: 'error', message: impersonating ? AVATAR_UPLOAD_COPY.impersonating : AVATAR_UPLOAD_COPY.failed });
  }
}
