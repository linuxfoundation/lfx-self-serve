// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, Location } from '@angular/common';
import { Component, computed, DestroyRef, inject, makeStateKey, PLATFORM_ID, REQUEST_CONTEXT, Signal, TransferState } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { MEETING_V2_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { AuthContext, User } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { filter } from 'rxjs';

import { MeetingComposerHostComponent } from './modules/meetings/meeting-composer/meeting-composer-host.component';
import { MeetingComposerService } from './modules/meetings/meeting-composer/meeting-composer.service';
import { getRuntimeConfig } from './shared/providers/runtime-config.provider';
import { AccountContextService } from './shared/services/account-context.service';
import { DataDogRumService } from './shared/services/datadog-rum.service';
import { FeatureFlagService } from './shared/services/feature-flag.service';
import { IntercomService } from './shared/services/intercom.service';
import { PersonaService } from './shared/services/persona.service';
import { PlausibleService } from './shared/services/plausible.service';
import { ProjectContextService } from './shared/services/project-context.service';
import { SegmentService } from './shared/services/segment.service';
import { UserService } from './shared/services/user.service';

const ACCESS_DENIED_MESSAGES: Record<string, string> = {
  meetings: "You don't have permission to schedule meetings for this project.",
  'mailing-lists': "You don't have permission to manage mailing lists for this project.",
  votes: "You don't have permission to manage votes for this project.",
  surveys: "You don't have permission to manage surveys for this project.",
  committees: "You don't have permission to manage committees for this project.",
};

@Component({
  selector: 'lfx-root',
  imports: [RouterOutlet, ToastModule, MeetingComposerHostComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly userService = inject(UserService);
  private readonly segmentService = inject(SegmentService);
  private readonly plausibleService = inject(PlausibleService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly dataDogRumService = inject(DataDogRumService);
  private readonly accountContextService = inject(AccountContextService);
  private readonly intercomService = inject(IntercomService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);
  protected readonly meetingComposer = inject(MeetingComposerService);
  /**
   * Whether meetings v2 is enabled for this user.
   * @description The host is mounted here for every page, so this is the one read that decides
   * whether the composer exists in the tree at all. Read as a signal so the host appears once
   * LaunchDarkly resolves without any manual change detection, and defaulted to `false` so a slow
   * or unreachable provider leaves the tree exactly as pre-v2 — the entry points are gated on the
   * same flag, so with it off nothing can ask the composer to open. See `MEETING_V2_ENABLED_FLAG`.
   */
  protected readonly meetingsV2Enabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(MEETING_V2_ENABLED_FLAG, false);
  // Mirrors writerGuard's cheap paths so the composer chunk is prefetched for the personas that
  // actually open it. Meeting-coordinator and committee-writer grants aren't known this early, so
  // those users fall back to the `when` trigger and download the chunk on click. Gated on the flag
  // too, so a non-targeted user never downloads the v2 chunk at all.
  protected readonly canPrefetchComposer = computed(
    () => this.meetingsV2Enabled() && (this.projectContextService.canWrite() || this.personaService.currentPersona() === 'executive-director')
  );
  /**
   * Whether the composer host belongs in the tree right now.
   * @description `meetingsV2Enabled()` is deliberately reactive — `FeatureFlagService` re-evaluates it
   * on LaunchDarkly's `ConfigurationChanged`/`ContextChanged` events — so a targeting change mid-session
   * can flip it true → false under a composer that is already open. On the flag alone that unmounts the
   * host, which takes the component-scoped `MeetingComposerFormService` and the organizer's unfilled
   * meeting with it, while `MeetingComposerService.isOpen()` stays true because only `close()` clears the
   * context: the composer is gone from the screen but still logically open, and a later flag-on remounts a
   * host that immediately reopens that stale context. So an open composer keeps itself mounted until it
   * closes. This cannot let an untargeted user in: every entry point is gated on the same flag and the
   * deep-link routes render the pre-v2 screens, so `isOpen()` is false for them and neither the host nor
   * its chunk is ever reached (`canPrefetchComposer` stays on the flag alone).
   */
  protected readonly composerHostMounted = computed(() => this.meetingsV2Enabled() || this.meetingComposer.isOpen());
  public auth: AuthContext | undefined;
  public transferState = inject(TransferState);
  public serverKey = makeStateKey<AuthContext>('auth');

  public constructor() {
    // Initialize Segment tracking
    this.segmentService.initialize();

    // Initialize Plausible analytics
    this.plausibleService.initialize();

    const reqContext = inject(REQUEST_CONTEXT, { optional: true }) as {
      auth: AuthContext;
    };

    if (reqContext) {
      // The context is defined in the server*.ts file
      this.auth = reqContext.auth;

      // Store this as this won't be available on hydration
      this.transferState.set(this.serverKey, this.auth);
    }

    // Hydrate the auth state from the server, if it exists, otherwise set it to false and null
    this.auth = this.transferState.get(this.serverKey, {
      authenticated: false,
      user: null,
      persona: null,
      organizations: [],
    });

    if (this.auth?.authenticated && this.auth.user) {
      this.userService.authenticated.set(true);
      this.userService.user.set(this.auth.user);

      // Initialize user organizations from backend (matched from committee memberships)
      if (this.auth.organizations && this.auth.organizations.length > 0) {
        this.accountContextService.initializeUserOrganizations(this.auth.organizations);
      }

      this.userService.canImpersonate.set(Boolean(this.auth?.canImpersonate));

      const isImpersonating = Boolean(this.auth?.impersonating);
      this.segmentService.setImpersonating(isImpersonating);
      this.plausibleService.setImpersonating(isImpersonating);
      this.dataDogRumService.setImpersonating(isImpersonating);
      this.userService.impersonating.set(isImpersonating);
      this.userService.impersonator.set(isImpersonating ? (this.auth.impersonator ?? null) : null);

      this.segmentService.identifyUser(this.auth.user);

      const authedUser = this.auth.user;

      // Initialize feature flags with user context
      this.featureFlagService.initialize(authedUser).catch((error) => {
        console.error('Failed to initialize feature flags:', error);
      });

      if (!isImpersonating) {
        this.bootIntercom(authedUser);
      }

      // Set DataDog RUM user context for session tracking
      this.dataDogRumService.setUser(this.auth.user);
    }

    this.initAccessDeniedToast();
    this.initProjectQueryParamSync();
  }

  // Fails closed: missing JWT or App ID skips boot.
  private bootIntercom(user: User): void {
    // Browser-only: avoid per-request warn spam during SSR when claim is absent.
    if (typeof window === 'undefined') {
      return;
    }

    const intercomJwt = user['http://lfx.dev/claims/intercom'];
    const userId = user['https://sso.linuxfoundation.org/claims/username'] || user.sub;
    const { intercomAppId } = getRuntimeConfig(this.transferState);

    if (!intercomAppId) {
      console.warn('Intercom: boot skipped — no app ID in runtime config');
      return;
    }

    if (!intercomJwt || !userId) {
      console.warn('Intercom boot skipped: App ID present but missing identity', {
        hasJwt: !!intercomJwt,
        hasUserId: !!userId,
      });
      return;
    }

    console.info('Intercom: dispatching boot', {
      hasJwt: !!intercomJwt,
      hasUserId: !!userId,
      hasName: !!user.name,
      hasEmail: !!user.email,
    });

    this.intercomService.boot({
      app_id: intercomAppId,
      intercom_user_jwt: intercomJwt,
      user_id: userId,
      name: user.name,
      email: user.email,
    });
  }

  // Detects _notice query param placed by writerGuard on denial and shows the "Access
  // Denied" toast (`_notice=error` instead shows a transient-failure error toast). Using a
  // URL param rather than calling MessageService directly in the guard is necessary because
  // the guard runs server-side under RenderMode.Server —
  // MessageService.add() on the server has no DOM to render into. The param survives the
  // SSR redirect so the client always sees it on NavigationEnd regardless of how the user
  // arrived (SPA click or copy-paste full-page-load).
  private initAccessDeniedToast(): void {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;

    const router = inject(Router);
    const location = inject(Location);
    const messageService = inject(MessageService);
    const destroyRef = inject(DestroyRef);

    const validNoticeKeys = new Set([...Object.keys(ACCESS_DENIED_MESSAGES), 'access']);

    router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(destroyRef)
      )
      .subscribe(() => {
        const parsed = router.parseUrl(router.url);
        const raw = parsed.queryParams['_notice'];
        if (!raw) return;

        const noticeKey = String(raw);

        // Strip _notice unconditionally — even invalid values must not linger
        // and re-trigger this subscriber on subsequent NavigationEnd events.
        delete parsed.queryParams['_notice'];
        location.replaceState(router.serializeUrl(parsed));

        // `_notice=error` means a guard's access check failed transiently — not a denial —
        // so the copy must not read as a permission loss.
        if (noticeKey === 'error') {
          messageService.add({
            severity: 'error',
            summary: 'Something Went Wrong',
            detail: "We couldn't verify your access to that page. Please try again.",
          });
          return;
        }

        if (!validNoticeKeys.has(noticeKey)) return;

        messageService.add({
          severity: 'warn',
          summary: 'Access Denied',
          detail: ACCESS_DENIED_MESSAGES[noticeKey] ?? "You don't have permission to perform this action for this project.",
        });
      });
  }

  // Backfills ?project=<slug> for cookie-restored context on a fresh load so every copyable URL
  // is self-describing (LFXV2-2837). Skipped whenever the activated route carries its own params
  // (e.g. /foundation/groups/:id) — those entity pages derive context from the entity itself via
  // syncEntityProjectContext, which may resolve a different project than the cookie; backfilling
  // here first would race it and could write the wrong slug into the URL.
  private initProjectQueryParamSync(): void {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;

    const router = inject(Router);
    const location = inject(Location);
    const destroyRef = inject(DestroyRef);

    router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(destroyRef)
      )
      .subscribe(() => {
        // Read the live browser URL rather than router.url — the access-denied listener above may
        // have already stripped `_notice` via a direct Location.replaceState on this same
        // NavigationEnd tick, and router.url does not reflect history changes made outside the
        // Router. Reparsing router.url here would resurrect the stripped param.
        const parsed = router.parseUrl(location.path(true));
        if ('project' in parsed.queryParams) return;

        // Derived from this navigation's own snapshot rather than
        // projectContextService.activeRouteLensKind() — that signal is updated by
        // MainLayoutComponent on this same NavigationEnd, but AppComponent's subscription (registered
        // at bootstrap) always runs first, so reading the signal here would see the previous route's
        // stale kind for one tick on lens-less routes (e.g. /profile, /badges).
        let snapshot = router.routerState.snapshot.root;
        let kind: 'foundation' | 'project' | null = null;
        while (snapshot.firstChild) {
          snapshot = snapshot.firstChild;
          const declared = snapshot.data['lens'];
          if (declared === 'foundation' || declared === 'project') kind = declared;
        }
        if (Object.keys(snapshot.params).length > 0) return;
        if (!kind) return;

        const context = kind === 'foundation' ? this.projectContextService.selectedFoundation() : this.projectContextService.selectedProject();
        if (!context?.slug) return;

        parsed.queryParams['project'] = context.slug;
        location.replaceState(router.serializeUrl(parsed));
      });
  }
}
