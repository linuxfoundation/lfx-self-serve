// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, inject, makeStateKey, REQUEST_CONTEXT, TransferState } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthContext } from '@lfx-one/shared/interfaces';
import { ToastModule } from 'primeng/toast';

import { AccountContextService } from './shared/services/account-context.service';
import { FeatureFlagService } from './shared/services/feature-flag.service';
import { PersonaService } from './shared/services/persona.service';
import { SegmentService } from './shared/services/segment.service';
import { UserService } from './shared/services/user.service';

@Component({
  selector: 'lfx-root',
  imports: [RouterOutlet, CommonModule, ToastModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly userService = inject(UserService);
  private readonly personaService = inject(PersonaService);
  private readonly segmentService = inject(SegmentService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly accountContextService = inject(AccountContextService);

  public auth: AuthContext | undefined;
  public transferState = inject(TransferState);
  public serverKey = makeStateKey<AuthContext>('auth');

  public constructor() {
    // Initialize Segment tracking
    this.segmentService.initialize();

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

      // Initialize persona from backend (auto-detected from committee membership)
      this.personaService.initializeFromAuth(this.auth.persona);

      // Initialize user organizations from backend (matched from committee memberships)
      if (this.auth.organizations && this.auth.organizations.length > 0) {
        this.accountContextService.initializeUserOrganizations(this.auth.organizations);
      }

      // Identify user with Segment tracking (pass entire Auth0 user object)
      this.segmentService.identifyUser(this.auth.user);

      // Initialize feature flags with user context
      this.featureFlagService.initialize(this.auth.user).catch((error) => {
        console.error('Failed to initialize feature flags:', error);
      });
    }
  }
}
