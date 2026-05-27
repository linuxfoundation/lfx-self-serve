// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, makeStateKey, REQUEST_CONTEXT, TransferState } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthContext, User } from '@lfx-one/shared/interfaces';
import { ToastModule } from 'primeng/toast';

import { getRuntimeConfig } from './shared/providers/runtime-config.provider';
import { AccountContextService } from './shared/services/account-context.service';
import { DataDogRumService } from './shared/services/datadog-rum.service';
import { FeatureFlagService } from './shared/services/feature-flag.service';
import { IntercomService } from './shared/services/intercom.service';
import { PlausibleService } from './shared/services/plausible.service';
import { SegmentService } from './shared/services/segment.service';
import { UserService } from './shared/services/user.service';

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
      return;
    }

    if (!intercomJwt || !userId) {
      console.warn('Intercom boot skipped: App ID present but missing identity', {
        hasJwt: !!intercomJwt,
        hasUserId: !!userId,
      });
      return;
    }

    this.intercomService.boot({
      app_id: intercomAppId,
      intercom_user_jwt: intercomJwt,
      user_id: userId,
      name: user.name,
      email: user.email,
    });
  }
}
