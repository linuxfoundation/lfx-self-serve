// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { EnvironmentProviders, inject, PLATFORM_ID, provideAppInitializer, TransferState } from '@angular/core';
import { clearGwEmbedBridgeStorage } from '@lfx-one/shared/utils';

import { getRuntimeConfig } from './runtime-config.provider';

/**
 * In Gatewaze host-session mode, removes what the LFID bridge left in browser storage
 * (`clearGwEmbedBridgeStorage`) once, when the app starts in the browser.
 *
 * At app start rather than in the embed outlet, because a user who never opens the embed again
 * would otherwise keep stored Gatewaze refresh tokens on this origin indefinitely. Nothing reads
 * them in host-session mode. With the mode off this does nothing, so the bridge keeps its sessions.
 */
export function initializeGwEmbedBridgeCleanup(): void {
  if (!isPlatformBrowser(inject(PLATFORM_ID)) || !getRuntimeConfig(inject(TransferState)).gwHostSession) {
    return;
  }

  clearGwEmbedBridgeStorage(
    () => window.localStorage,
    () => window.sessionStorage
  );
}

/** Must come after `provideRuntimeConfig()`, which it reads. */
export const provideGwEmbedBridgeCleanup = (): EnvironmentProviders => provideAppInitializer(initializeGwEmbedBridgeCleanup);
