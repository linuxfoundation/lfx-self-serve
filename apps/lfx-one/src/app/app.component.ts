// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, Location } from '@angular/common';
import { Component, DestroyRef, inject, makeStateKey, PLATFORM_ID, REQUEST_CONTEXT, TransferState } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { AuthContext, User } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { filter } from 'rxjs';

import { getRuntimeConfig } from './shared/providers/runtime-config.provider';
import { AccountContextService } from './shared/services/account-context.service';
import { DataDogRumService } from './shared/services/datadog-rum.service';
import { FeatureFlagService } from './shared/services/feature-flag.service';
import { IntercomService } from './shared/services/intercom.service';
import { PlausibleService } from './shared/services/plausible.service';
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
  imports: [RouterOutlet, ToastModule],
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
  // Denied" toast. Using a URL param rather than calling MessageService directly in the
  // guard is necessary because the guard runs server-side under RenderMode.Server —
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
        const notice = parsed.queryParams['_notice'];
        if (!notice || !validNoticeKeys.has(String(notice))) return;

        messageService.add({
          severity: 'warn',
          summary: 'Access Denied',
          detail: ACCESS_DENIED_MESSAGES[notice] ?? "You don't have permission to perform this action for this project.",
        });

        // Remove _notice from the URL without triggering another navigation cycle
        delete parsed.queryParams['_notice'];
        location.replaceState(router.serializeUrl(parsed));
      });
  }
}
