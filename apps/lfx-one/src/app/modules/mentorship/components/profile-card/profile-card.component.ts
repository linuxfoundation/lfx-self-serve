// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import {
  IDENTITY_LINK_ERROR_MESSAGES,
  LFX_PROFILE_CARD_CONNECT_IMPERSONATING_LABEL,
  LFX_PROFILE_CARD_CONNECT_LABEL,
  LFX_PROFILE_CARD_EDIT_DISABLED_TOOLTIP,
  LFX_PROFILE_CARD_EDIT_LABEL,
  LFX_PROFILE_CARD_EMPTY,
  LFX_PROFILE_CARD_LABELS,
  LFX_PROFILE_CARD_LINK_ALREADY_LINKED_DETAIL,
  LFX_PROFILE_CARD_LINK_ERROR_FALLBACK,
  LFX_PROFILE_CARD_LINK_INCOMPLETE_DETAIL,
  LFX_PROFILE_CARD_LINK_SUCCESS_DETAIL,
  LFX_PROFILE_CARD_PRIMARY_BADGE,
  LFX_PROFILE_CARD_SUBTITLE,
  LFX_PROFILE_CARD_TITLE,
  PROFILE_AUTH_ERROR_MESSAGES,
} from '@lfx-one/shared/constants';
import {
  AddAccountDialogData,
  CombinedProfile,
  EmailManagementData,
  EnrichedIdentity,
  IdentityProvider,
  LfxProfileSummary,
  UserMetadata,
} from '@lfx-one/shared/interfaces';
import { buildLfxProfileSummary } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, forkJoin, map, Observable, of, startWith, switchMap, take, tap } from 'rxjs';

import { AddAccountDialogComponent } from '../../../profile/components/add-account-dialog/add-account-dialog.component';
import { ProfileEditDrawerComponent } from '../../../profile/components/profile-edit-drawer/profile-edit-drawer.component';
import { ProfileEditDrawerService } from '../../../profile/components/profile-edit-drawer/profile-edit-drawer.service';

/**
 * Read-only summary of the signed-in user's LFX profile, shown above the mentorship
 * registration forms so the applicant can see what the program admin will receive
 * without retyping any of it. The "Edit LFX Profile" button opens the profile-edit
 * drawer (the same one used in the Profile & Account hub) so the mentor can fix
 * missing fields in place rather than navigating away from the form.
 *
 * The one exception is an unconnected GitHub or LinkedIn account, which opens the profile
 * module's Add-identity dialog right here: that flow is built, and a mentor profile missing
 * the accounts candidates look for is worth offering to fix rather than only reporting.
 * Choosing a provider in the dialog hands off to Auth0 as a full-page redirect — account
 * linking is an OAuth handshake, so no dialog can complete it in place — but the dialog names
 * the current page as the flow's `returnTo`, so the mentor lands back here with the new account
 * on the card. Anything typed into the form is still lost to that redirect, which is why the
 * card offers the dialog rather than opening it for them.
 *
 * Reporting the result of that round trip is the card's job too — see `ngOnInit`. The callback
 * answers in query params, and the page it returns to here has no profile shell to read them.
 *
 * The card owns its own fetch rather than taking the data as an input, so it can be
 * dropped onto any mentorship form without that page learning about three profile
 * endpoints.
 *
 * **Known limitation — Flow C redirect:** The drawer's Flow C redirect (management-token
 * authorization) sends the mentor to `/profile`, not back to the mentorship page, because
 * the PATCH and picture-upload 403 responses (profile.controller.ts:304, 431) hardcode
 * `returnTo=/profile` in their `authorize_url`. The server's `/api/profile/auth/start`
 * already accepts a client-supplied `returnTo`, and `/mentorship/mentor` is already in
 * `allowedProfileReturnPaths` (line 109), so the follow-up is a one-line server change
 * to derive `returnTo` from the referer (matching the sibling endpoints at :971, :1035,
 * :1483) or a client-side rewrite of the returned `authorize_url` param. Neither is in
 * scope here; Flow C only triggers on the first profile edit or after token expiry, so
 * most mentors will already hold the management token from a prior session. See #2619.
 */
@Component({
  selector: 'lfx-mentorship-profile-card',
  imports: [AvatarComponent, ButtonComponent, SkeletonModule, ProfileEditDrawerComponent],
  providers: [DialogService, ProfileEditDrawerService],
  templateUrl: './profile-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileCardComponent implements OnInit {
  private readonly userService = inject(UserService);
  private readonly editDrawer = inject(ProfileEditDrawerService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly title = LFX_PROFILE_CARD_TITLE;
  protected readonly subtitle = LFX_PROFILE_CARD_SUBTITLE;
  protected readonly editLabel = LFX_PROFILE_CARD_EDIT_LABEL;
  protected readonly primaryBadge = LFX_PROFILE_CARD_PRIMARY_BADGE;
  protected readonly placeholder = LFX_PROFILE_CARD_EMPTY;
  protected readonly connectLabel = LFX_PROFILE_CARD_CONNECT_LABEL;
  protected readonly impersonatingLabel = LFX_PROFILE_CARD_CONNECT_IMPERSONATING_LABEL;
  protected readonly labels = LFX_PROFILE_CARD_LABELS;

  /** The raw profile passed to the edit drawer on open — retained from `initSummary`. */
  private readonly combinedProfile = signal<CombinedProfile | null>(null);

  /**
   * True only after the profile fetch returned an error. Distinguishes "still loading"
   * (both `combinedProfile` and `profileFetchFailed` are falsy) from "degraded"
   * (`combinedProfile` is null **and** `profileFetchFailed` is true). The tooltip and
   * aria-label on the Edit button only surface the failure explanation once this flips,
   * so a slow-but-healthy GET never prematurely tells the mentor to reload.
   */
  protected readonly profileFetchFailed = signal(false);

  /** Cached from the latest fetch so `applyOptimisticProfileUpdate` can rebuild the summary. */
  private cachedEmails: EmailManagementData | null = null;
  private cachedIdentities: EnrichedIdentity[] | null = null;

  /**
   * Stashed when the save resolves before a base profile exists (null `combinedProfile` or
   * null `profile`). `reapplyOptimisticMetadata` merges it into the first non-null GET so
   * a stale eventually-consistent body can't mask the write — same pattern as
   * `ProfileLayoutComponent.pendingOptimisticMetadata`.
   */
  private pendingOptimisticMetadata: Partial<UserMetadata> | null = null;

  /**
   * Set by `applyOptimisticProfileUpdate` after a save; takes priority over the fetched
   * summary so the card reflects the change immediately without waiting on the
   * eventually-consistent profile GET.
   */
  private readonly optimisticSummary = signal<LfxProfileSummary | null>(null);

  /**
   * Disables the Edit button while the profile endpoint has not returned (or degraded).
   * Without this, a mentor who clicks Edit after a profile-fetch failure gets no drawer,
   * no toast, and no indication of why — the button just does nothing.
   */
  protected readonly canEdit = computed(() => this.combinedProfile() !== null);

  /**
   * Aria-label for the Edit button, gated on `profileFetchFailed` rather than `canEdit`
   * so a slow-but-healthy load never prematurely tells the mentor to reload. When the
   * fetch is still in flight, the label stays normal — the disabled state alone is
   * sufficient during loading. A visible hint (`@if (profileFetchFailed())` in the
   * template) handles the sighted/keyboard case that a tooltip on a disabled native
   * button cannot reach.
   */
  protected readonly editAriaLabel = computed(() => (this.profileFetchFailed() ? LFX_PROFILE_CARD_EDIT_DISABLED_TOOLTIP : this.editLabel));

  /**
   * Disables Connect, the way the Identities tab disables its own Add-identity button. Two
   * reasons, either sufficient: the connect route is behind `blockDuringImpersonation` inside the
   * `/api` error-handler mount, and the dialog reaches it with a top-level navigation, so a click
   * would replace the registration form with the error JSON; and the card is showing the
   * impersonated user's profile while the link could only ever attach to the impersonator.
   */
  protected readonly impersonating = this.userService.impersonating;
  /** One skeleton row per field the loaded card will show, so the placeholder matches its height. */
  protected readonly loadingRows = Object.keys(LFX_PROFILE_CARD_LABELS);

  /** Null only while the three requests are still in flight — see `initSummary`. */
  private readonly fetchedSummary = this.initSummary();

  /**
   * The displayed summary: prefers the optimistic override set after a save, falling
   * through to the last fetched value. The optimistic version persists until the card
   * is destroyed (navigation away) — same lifetime as `ProfileLayoutComponent.optimisticProfileData`.
   */
  protected readonly summary = computed(() => this.optimisticSummary() ?? this.fetchedSummary());

  /**
   * The profile's own picture, falling back to the session's avatar the way the sidebar
   * and header do. Without the fallback this card would show initials for a user whose
   * photo comes from the OIDC claim rather than an LFX upload — the same person, with a
   * photo two panels away.
   */
  protected readonly avatarUrl = computed(() => this.summary()?.avatarUrl || this.userService.effectiveAvatarUrl());

  /**
   * What the dialog is told is already linked. Only the two platforms this card renders can be
   * known from here — it never fetched the others — but `AddAccountDialogData` asks for the list,
   * and an accurate partial answer beats an empty one.
   */
  private readonly connectedProviders = computed<IdentityProvider[]>(() => {
    const profile = this.summary();
    return [profile?.github ? 'github' : null, profile?.linkedin ? 'linkedin' : null].filter((provider): provider is IdentityProvider => provider !== null);
  });

  /**
   * Reports how the account-link round trip ended.
   *
   * `handleSocialCallback` returns to whichever page opened the dialog and says what happened in
   * `?success=` / `?error=`. Under `/profile` those are read by the Identities tab and by
   * `ProfileLayoutComponent`; the mentorship forms mount under the main layout, where neither
   * exists — so without this the mentor completes the whole Auth0 handshake, lands back on the
   * form, and is told nothing while a stale `?error=` sits in the address bar.
   *
   * Read from the route snapshot rather than the `queryParams` observable because
   * `clearCallbackParams` strips them with `history.replaceState`, which the Router never sees.
   *
   * Browser-only in full: this page is server-rendered with hydration, and the app's single
   * `<p-toast/>` lives in the root template — so running here on the server would render a toast
   * into the HTML that the client then adds a second time, leaving the two renders disagreeing
   * about that subtree. There is also nothing on the server that could consume the refresh.
   */
  public ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const params = this.route.snapshot.queryParams;

    if (params['success'] === 'identity_linked') {
      // Re-reads the summary off `identitiesRefresh$`, so the account appears without a reload.
      this.userService.refreshUserIdentities();
      this.announce('success', 'Success', LFX_PROFILE_CARD_LINK_SUCCESS_DETAIL);
      return;
    }

    // Flow C minted a management token but the pending social connect was gone by the time it
    // returned, so the handshake stopped one step short of linking anything. Say that, rather
    // than let a bare `?success=` read as an account that was connected.
    if (params['success'] === 'profile_token_obtained') {
      this.announce('info', 'Not linked yet', LFX_PROFILE_CARD_LINK_INCOMPLETE_DETAIL);
      return;
    }

    const errorCode = params['error'];
    if (typeof errorCode !== 'string' || !errorCode) {
      return;
    }

    this.announce('error', 'Error', this.linkErrorDetail(errorCode));
  }

  protected onEdit(): void {
    const profile = this.combinedProfile();
    if (!profile) return;
    this.editDrawer.open(profile);
  }

  /**
   * Apply the saved metadata from the edit drawer optimistically — merge into the cached
   * `CombinedProfile` and rebuild the summary so the card reflects the change immediately,
   * without waiting on the eventually-consistent profile GET. Matches the pattern in
   * `ProfileLayoutComponent.onProfileSaved`.
   */
  protected onProfileSaved(metadata: Partial<UserMetadata>): void {
    this.applyOptimisticProfileUpdate(metadata);
    if (metadata.picture) {
      this.userService.uploadedAvatarUrl.set(metadata.picture);
    }
  }

  /**
   * Opens the profile module's own Add-identity dialog, so connecting an account starts here
   * rather than sending the mentor off to `/profile/identities` with a half-filled form behind
   * them. Same config as the Identities tab uses, and the same refresh on close: the dialog
   * itself does not announce the change, and `identitiesRefresh$` is what the profile shell
   * listens to as well.
   */
  protected onConnect(): void {
    // The button is disabled while impersonating, so this is only reachable programmatically —
    // but what it costs to arrive here is the error JSON replacing the page, so refuse outright
    // rather than trust the view to be the only guard.
    if (this.impersonating()) {
      return;
    }

    const dialogRef = this.dialogService.open(AddAccountDialogComponent, {
      header: 'Add identity',
      width: '480px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: {
        existingProviders: this.connectedProviders(),
        // Email's Flow C authorize URL is fixed to `/profile/emails`, so offering it here
        // would abandon the registration form. Only the two platforms this card renders.
        allowedProviders: (['github', 'linkedin'] as const).filter((provider) => !this.connectedProviders().includes(provider)),
      } satisfies AddAccountDialogData,
    }) as DynamicDialogRef;

    // `take(1)` only completes when the dialog closes. If the mentor leaves the page first,
    // `takeUntilDestroyed` is what tears this down with the card — `onConnect` is a method,
    // so DestroyRef has to be passed rather than injected from this call site.
    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result) {
        this.userService.refreshUserIdentities();
      }
    });
  }

  /**
   * Name, emails, and linked accounts live behind three separate endpoints, so fetch
   * them together and let each one fail on its own. A partial outage should cost the
   * user the affected rows, not the whole card — `buildLfxProfileSummary` fills the
   * gaps, and the template renders a placeholder per field.
   *
   * Each fallback logs before it degrades. For name/email/address a failed fetch looks
   * like an empty field; identities do not — Connect is only offered when that request
   * succeeded, so an outage cannot start OAuth for an account we could not see.
   *
   * Re-runs on `identitiesRefresh$`, the same trigger the Identities tab and the profile shell
   * fetch off (LFXV2-2767), so an account linked from this card's own dialog lands here without
   * the mentor reloading the page. `switchMap` holds the last summary until the new one arrives,
   * so a refresh never flashes the skeleton back up.
   */
  private initSummary() {
    return toSignal<LfxProfileSummary | null>(
      this.userService.identitiesRefresh$.pipe(
        startWith(undefined),
        switchMap(() => {
          this.profileFetchFailed.set(false);
          return forkJoin({
            combined: this.userService.getCurrentUserProfile().pipe(catchError((error) => this.degrade('profile', error, null))),
            emails: this.userService.getUserEmails().pipe(catchError((error) => this.degrade('emails', error, null))),
            identities: this.userService.getIdentities().pipe(catchError((error) => this.degrade('identities', error, null))),
          }).pipe(
            tap(({ combined, emails, identities }) => {
              this.combinedProfile.set(combined);
              this.profileFetchFailed.set(combined === null);
              this.cachedEmails = emails;
              this.cachedIdentities = identities;
              this.reapplyOptimisticMetadata();
            }),
            map(({ combined, emails, identities }) => buildLfxProfileSummary(combined, emails, identities))
          );
        })
      ),
      { initialValue: null }
    );
  }

  /**
   * Both shared maps are consulted, unlike the Identities tab which defers half of them:
   * `PROFILE_AUTH_ERROR_MESSAGES` is `ProfileLayoutComponent`'s to own under `/profile`, and
   * nothing owns it here, so skipping those codes would go silent instead of avoiding a double
   * toast. `already_linked` is in neither map and points at the tab that can resolve it.
   *
   * Every lookup is `Object.hasOwn`-guarded because `errorCode` is unvalidated URL input: an
   * inherited key such as `toString` would otherwise resolve to a truthy non-message.
   */
  private linkErrorDetail(errorCode: string): string {
    if (errorCode === 'already_linked') {
      return LFX_PROFILE_CARD_LINK_ALREADY_LINKED_DETAIL;
    }
    if (Object.hasOwn(IDENTITY_LINK_ERROR_MESSAGES, errorCode)) {
      return IDENTITY_LINK_ERROR_MESSAGES[errorCode];
    }
    if (Object.hasOwn(PROFILE_AUTH_ERROR_MESSAGES, errorCode)) {
      return PROFILE_AUTH_ERROR_MESSAGES[errorCode];
    }
    return LFX_PROFILE_CARD_LINK_ERROR_FALLBACK;
  }

  /** Toasts the outcome, then drops the params so a reload can't replay the message. */
  private announce(severity: 'success' | 'info' | 'error', summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail });
    this.clearCallbackParams();
  }

  /**
   * `history.replaceState` rather than a router navigation, so stripping the params cannot
   * re-run this route and tear down the registration form beneath the card. The fragment is
   * kept: it belongs to the page, not to the callback.
   *
   * The platform check is redundant with `ngOnInit`'s and kept anyway, so this stays safe to
   * call from anywhere — `ssr-safety.md` asks for the guard at the reference, not at the caller.
   */
  private clearCallbackParams(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.hash);
  }

  /** Records which of the three sources dropped out, then yields its per-field fallback. */
  private degrade<T>(source: string, error: unknown, fallback: T): Observable<T> {
    console.error(`mentorship-profile-card: ${source} fetch failed, rendering placeholders for those fields`, error);
    return of(fallback);
  }

  /**
   * Reflect a just-saved profile change immediately, without waiting on the
   * eventually-consistent profile GET. Mirrors `ProfileLayoutComponent.applyOptimisticProfileUpdate`:
   * merges the saved metadata into `combinedProfile` (so a reopened drawer seeds correctly)
   * and rebuilds the displayed summary from cached emails/identities.
   *
   * When no base profile exists yet (null profile record), stashes the metadata and triggers
   * a refetch — `reapplyOptimisticMetadata` merges it once a base profile lands.
   */
  private applyOptimisticProfileUpdate(metadata: Partial<UserMetadata>): void {
    const current = this.combinedProfile();
    if (!current || current.profile == null) {
      this.pendingOptimisticMetadata = { ...(this.pendingOptimisticMetadata ?? {}), ...metadata };
      this.userService.refreshUserIdentities();
      return;
    }

    // Drop `key: undefined` entries (omitted from the PATCH, so unchanged upstream) so the optimistic
    // view mirrors what was persisted. Cleared free-text fields send '' and are kept.
    const definedMetadata = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)) as Partial<UserMetadata>;

    const merged: CombinedProfile = {
      ...current,
      user: {
        ...current.user,
        // user.first_name / last_name are derived from given_name / family_name server-side
        first_name: definedMetadata.given_name ?? current.user.first_name,
        last_name: definedMetadata.family_name ?? current.user.last_name,
      },
      profile: {
        ...current.profile,
        ...definedMetadata,
      },
    };

    this.combinedProfile.set(merged);
    this.optimisticSummary.set(buildLfxProfileSummary(merged, this.cachedEmails, this.cachedIdentities));
    // The merge supersedes any stash; clear it so a later GET doesn't re-apply a now-stale overlay.
    this.pendingOptimisticMetadata = null;
  }

  /**
   * After a GET populates `combinedProfile`, re-apply metadata that was stashed because no
   * base profile existed when the save resolved. Prevents an eventually-consistent (pre-save)
   * body from masking the write. Same pattern as `ProfileLayoutComponent.reapplyPendingOptimisticUpdate`.
   */
  private reapplyOptimisticMetadata(): void {
    const pending = this.pendingOptimisticMetadata;
    if (!pending || this.combinedProfile()?.profile == null) return;
    this.pendingOptimisticMetadata = null;
    this.applyOptimisticProfileUpdate(pending);
  }
}
