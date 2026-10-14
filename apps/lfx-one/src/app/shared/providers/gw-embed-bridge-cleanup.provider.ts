// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { EnvironmentProviders, inject, PLATFORM_ID, provideAppInitializer } from '@angular/core';
import { clearGwEmbedBridgeStorage, hasAuthFragment } from '@lfx-one/shared/utils';

/**
 * Removes what the retired Gatewaze LFID bridge left behind, once, when the app starts in the
 * browser:
 *
 * - Its stored sessions and sign-in keys (`clearGwEmbedBridgeStorage`).
 * - A token fragment (`#access_token=…`) in the address bar. A bridge sign-in started before the
 *   bridge was removed, or a crafted link, can still land on that shape, and nothing adopts it any
 *   more, so the live tokens would otherwise stay in the address bar and in history. A fragment
 *   with no credential key, e.g. `#section`, is left alone.
 *
 * At app start rather than in the embed outlet, because a user who never opens the embed again would
 * otherwise keep stored Gatewaze refresh tokens on this origin indefinitely. Unconditional: nothing
 * reads any of it any more, whatever the Gatewaze flags say, and the removal is cheap. Datadog RUM
 * redacts the fragment from what it records (`redactAuthFragment`), so the order against its
 * initializer does not matter.
 */
export function initializeGwEmbedBridgeCleanup(): void {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return;
  }

  clearGwEmbedBridgeStorage(
    () => window.localStorage,
    () => window.sessionStorage
  );

  if (hasAuthFragment(window.location.hash)) {
    // `history.state` is passed through: the Angular Router keeps its own navigation state there.
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
  }
}

export const provideGwEmbedBridgeCleanup = (): EnvironmentProviders => provideAppInitializer(initializeGwEmbedBridgeCleanup);
