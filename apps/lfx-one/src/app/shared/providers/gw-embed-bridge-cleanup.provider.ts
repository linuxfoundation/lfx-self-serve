// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { EnvironmentProviders, inject, PLATFORM_ID, provideAppInitializer } from '@angular/core';
import { clearGwEmbedBridgeStorage } from '@lfx-one/shared/utils';

/**
 * Removes what the retired Gatewaze LFID bridge left in browser storage (`clearGwEmbedBridgeStorage`)
 * once, when the app starts in the browser.
 *
 * At app start rather than in the embed outlet, because a user who never opens the embed again would
 * otherwise keep stored Gatewaze refresh tokens on this origin indefinitely. Unconditional: nothing
 * reads those keys any more, whatever the Gatewaze flags say, and the removal is cheap.
 */
export function initializeGwEmbedBridgeCleanup(): void {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return;
  }

  clearGwEmbedBridgeStorage(
    () => window.localStorage,
    () => window.sessionStorage
  );
}

export const provideGwEmbedBridgeCleanup = (): EnvironmentProviders => provideAppInitializer(initializeGwEmbedBridgeCleanup);
