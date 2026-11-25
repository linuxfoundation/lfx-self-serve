// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, DestroyRef, inject, Injectable, Injector, PLATFORM_ID } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  EMAIL_ALREADY_CONNECTED_MESSAGE,
  EMAIL_ALREADY_CONNECTED_STATUS,
  EMAIL_ALREADY_CONNECTED_SUMMARY,
  EMAIL_ALREADY_LINKED_MESSAGE,
  EMAIL_CALLBACK_ALREADY_LINKED_STATUS,
  EMAIL_CALLBACK_RETRY_MESSAGE,
  EMAIL_CALLBACK_RETRY_REQUIRED_STATUS,
  EMAIL_CALLBACK_STATUS_PARAM,
  EMAIL_LINKED_SUPPORT_CONTEXT_PARAM,
  EMAIL_LINKED_SUPPORT_TITLE,
  EMAIL_LINKED_SUPPORT_TOAST_KEY,
  PENDING_PROFILE_SAVE_KEY,
  PROFILE_AUTH_ERROR_MESSAGES,
} from '@lfx-one/shared/constants';
import { ProfileUpdateRequest, UserMetadata } from '@lfx-one/shared/interfaces';
import { buildLinkedEmailSupportMessage } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { filter } from 'rxjs';

/**
 * Handles the Flow C (profile authorization) return for a page shell: replays a profile save stashed before the
 * redirect, reports the email-verification outcome and maps error codes to a toast, then strips the callback query.
 * Provided per shell (the Profile & Account hub and Account & Settings) and by the Profile page, so it runs once on whichever
 * page the authorization returns to.
 */
@Injectable()
export class ProfileAuthReturnService {
  // Discard a stored pending-save older than this. Prevents an abandoned profile-edit authorization
  // from being silently replayed by a later, unrelated profile-auth return (e.g. an email-delete
  // authorization that now lands on /profile/settings inside this shell).
  private static readonly pendingSaveTtlMs = 10 * 60 * 1000;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Starts watching the shell's query params; `onProfileSaved` receives a replayed profile save once it lands. */
  public listen(onProfileSaved: (metadata: Partial<UserMetadata>) => void): void {
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      // Keep callback markers intact during SSR; server-side query cleanup becomes an HTTP redirect.
      if (isPlatformBrowser(this.platformId) && params['success'] === 'profile_token_obtained') {
        this.replayPendingProfileSave(onProfileSaved);
        // Only read alongside the authorization flag, which on its own never implies an email outcome.
        this.handleEmailCallbackStatus(params[EMAIL_CALLBACK_STATUS_PARAM], params[EMAIL_LINKED_SUPPORT_CONTEXT_PARAM]);
        this.clearAuthQueryParams();
      }

      // hasOwn guard: params['error'] is unvalidated user input — an inherited Object.prototype
      // key (e.g. 'toString') would otherwise resolve as a truthy, non-string "message".
      const errorCode = params['error'];
      if (typeof errorCode === 'string' && Object.hasOwn(PROFILE_AUTH_ERROR_MESSAGES, errorCode)) {
        // Clear any stash so it can't be replayed by a later unrelated Flow C success. Unconditional
        // by design: an identity-link failure shares these codes too, and a stash still here is orphaned.
        if (isPlatformBrowser(this.platformId)) {
          sessionStorage.removeItem(PENDING_PROFILE_SAVE_KEY);
        }
        this.messageService.add({ severity: 'error', summary: 'Authorization Error', detail: PROFILE_AUTH_ERROR_MESSAGES[errorCode] });
        this.clearAuthQueryParams();
      }
    });
  }

  /** After returning from Flow C authorization, restore the saved form state and save it. */
  private replayPendingProfileSave(onProfileSaved: (metadata: Partial<UserMetadata>) => void): void {
    const savedState = sessionStorage.getItem(PENDING_PROFILE_SAVE_KEY);
    if (!savedState) {
      return;
    }

    sessionStorage.removeItem(PENDING_PROFILE_SAVE_KEY);

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
      if (typeof envelope?.savedAt !== 'number' || Date.now() - envelope.savedAt > ProfileAuthReturnService.pendingSaveTtlMs) {
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
      this.messageService.add({ severity: 'info', summary: 'Authorization complete', detail: 'Please re-select your image to upload it.' });
    }

    if (!userMetadata) {
      return;
    }

    const updateData: ProfileUpdateRequest = { user_metadata: userMetadata as UserMetadata };
    const savedMetadata = userMetadata;

    this.userService.updateUserProfile(updateData).subscribe({
      next: () => {
        // Optimistic update only — the profile GET is eventually consistent, so an immediate refetch
        // could overwrite the shell's profile with the pre-save body and reintroduce stale-on-reopen.
        onProfileSaved(savedMetadata);
        this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Profile updated successfully!' });
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to save profile. Please try again.' });
      },
    });
  }

  /**
   * Surface the outcome of an email verification the Flow C callback replayed after authorization.
   * The marker is presentation-only (no email, code, or token), so unknown values are ignored and
   * no outcome changes identity state locally — already-connected re-fetches the canonical list, while
   * already-linked and retry outcomes leave identities untouched. Already-linked goes to the shell's
   * keyed sticky toast after rendering; its private, one-shot context supplies only the proven address.
   */
  private handleEmailCallbackStatus(status: unknown, supportHandle?: unknown): void {
    if (status === EMAIL_ALREADY_CONNECTED_STATUS) {
      this.messageService.add({ severity: 'success', summary: EMAIL_ALREADY_CONNECTED_SUMMARY, detail: EMAIL_ALREADY_CONNECTED_MESSAGE });
      this.userService.refreshUserIdentities();
    } else if (status === EMAIL_CALLBACK_ALREADY_LINKED_STATUS) {
      const subject = this.userService.user()?.sub;
      // MessageService does not replay: the shell's keyed Toast must subscribe before we publish.
      afterNextRender(
        () => {
          this.userService
            .consumeLinkedEmailSupportContext(supportHandle)
            .pipe(
              takeUntilDestroyed(this.destroyRef),
              filter(() => this.userService.user()?.sub === subject && !this.userService.impersonating())
            )
            .subscribe(({ email }) => {
              this.messageService.add({
                key: EMAIL_LINKED_SUPPORT_TOAST_KEY,
                severity: 'warn',
                summary: EMAIL_LINKED_SUPPORT_TITLE,
                detail: EMAIL_ALREADY_LINKED_MESSAGE,
                sticky: true,
                data: { supportMessage: buildLinkedEmailSupportMessage(email) },
              });
            });
        },
        { injector: this.injector }
      );
    } else if (status === EMAIL_CALLBACK_RETRY_REQUIRED_STATUS) {
      this.messageService.add({ severity: 'warn', summary: 'Email not verified', detail: EMAIL_CALLBACK_RETRY_MESSAGE });
    }
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

  // Strip the Flow C query params (success/error/email_status) while staying on the current page.
  // Navigating relative to the route would resolve to the shell's parent route and bounce the user
  // to the default page — so re-navigate to the current path sans query. Keep the fragment (e.g.
  // #password): router.url serializes as path?query#fragment, so a naive split('?')[0] would drop it.
  private clearAuthQueryParams(): void {
    const [pathAndQuery, fragment] = this.router.url.split('#');
    const path = pathAndQuery.split('?')[0];
    this.router.navigateByUrl(fragment ? `${path}#${fragment}` : path, { replaceUrl: true });
  }
}
