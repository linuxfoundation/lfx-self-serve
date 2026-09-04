// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable } from '@angular/core';
import { datadogRum } from '@datadog/browser-rum';
import { User } from '@lfx-one/shared/interfaces';

/**
 * Service for managing DataDog RUM user context
 * Call setUser() after successful authentication
 * Call clearUser() on logout
 */
@Injectable({ providedIn: 'root' })
export class DataDogRumService {
  private impersonating = false;

  /**
   * Enable or disable product-analytics suppression for the current session.
   * Pass `true` while the user is impersonating another account so their activity
   * does not pollute the impersonated user's funnels. Mirrors PlausibleService/SegmentService.
   * @param isImpersonating Whether the current session is impersonated
   */
  public setImpersonating(isImpersonating: boolean): void {
    this.impersonating = isImpersonating;
  }

  /**
   * Set user context for RUM sessions
   * Associates all RUM data with the authenticated user
   */
  public setUser(user: User): void {
    if (typeof window === 'undefined') {
      return;
    }

    datadogRum.setUser({
      id: user['https://sso.linuxfoundation.org/claims/username'],
      name: user.name || '',
      email: user.email || '',
    });
  }

  /**
   * Clear user context (call on logout)
   */
  public clearUser(): void {
    if (typeof window === 'undefined') {
      return;
    }

    datadogRum.clearUser();
  }

  /**
   * Emit a custom error to RUM with optional context tags.
   * No-op on the server.
   */
  public addError(error: Error, context?: Record<string, unknown>): void {
    if (typeof window === 'undefined') {
      return;
    }

    datadogRum.addError(error, context);
  }

  /**
   * Emit a custom RUM action (product event) with optional context, attributed to the user
   * set via setUser(). Used for queryable per-user product analytics. No-op on the server and
   * while impersonating — setUser() assigns the impersonated user's identity, so an admin's click
   * would otherwise be attributed to them. addError stays ungated: errors are session telemetry.
   */
  public addAction(name: string, context?: Record<string, unknown>): void {
    if (typeof window === 'undefined' || this.impersonating) {
      return;
    }

    datadogRum.addAction(name, context);
  }
}
