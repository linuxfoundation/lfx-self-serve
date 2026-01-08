// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable } from '@angular/core';
import { datadogRum } from '@datadog/browser-rum';
import { User } from '@lfx-one/shared';

/**
 * Service for managing DataDog RUM user context
 * Call setUser() after successful authentication
 * Call clearUser() on logout
 */
@Injectable({ providedIn: 'root' })
export class DataDogRumService {
  /**
   * Set user context for RUM sessions
   * Associates all RUM data with the authenticated user
   */
  public setUser(user: User): void {
    if (typeof window === 'undefined') {
      return;
    }

    datadogRum.setUser({
      id: user.sub,
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
}
