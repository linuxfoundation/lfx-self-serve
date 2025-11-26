// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { COOKIE_REGISTRY_KEY } from '@lfx-one/shared/constants';
import { SsrCookieService } from 'ngx-cookie-service-ssr';

@Injectable({
  providedIn: 'root',
})
export class CookieRegistryService {
  private readonly cookieService = inject(SsrCookieService);

  public registerCookie(key: string): void {
    const registeredKeys = this.getAllRegisteredCookies();

    if (!registeredKeys.includes(key)) {
      registeredKeys.push(key);
      this.persistRegistry(registeredKeys);
    }
  }

  public getAllRegisteredCookies(): string[] {
    try {
      const stored = this.cookieService.get(COOKIE_REGISTRY_KEY);
      if (stored) {
        return JSON.parse(stored) as string[];
      }
    } catch {
      // Invalid data in registry cookie, return empty array
    }
    return [];
  }

  public clearAllCookies(): void {
    const registeredKeys = this.getAllRegisteredCookies();

    // Delete all registered cookies
    for (const key of registeredKeys) {
      this.cookieService.delete(key, '/');
    }

    // Clear the registry itself
    this.cookieService.delete(COOKIE_REGISTRY_KEY, '/');
  }

  public unregisterCookie(key: string): void {
    const registeredKeys = this.getAllRegisteredCookies();
    const index = registeredKeys.indexOf(key);

    if (index > -1) {
      registeredKeys.splice(index, 1);
      this.persistRegistry(registeredKeys);
    }
  }

  private persistRegistry(keys: string[]): void {
    this.cookieService.set(COOKIE_REGISTRY_KEY, JSON.stringify(keys), {
      expires: 365, // 1 year
      path: '/',
      sameSite: 'Lax',
      secure: process.env['NODE_ENV'] === 'production',
    });
  }
}
