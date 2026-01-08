// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EnvironmentProviders, inject, makeStateKey, provideAppInitializer, REQUEST_CONTEXT, TransferState } from '@angular/core';
import { RuntimeConfig } from '@lfx-one/shared';

/** TransferState key for runtime configuration */
export const RUNTIME_CONFIG_KEY = makeStateKey<RuntimeConfig>('runtimeConfig');

/** Default configuration when no config is provided */
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  launchDarklyClientId: '',
  dataDogRumClientId: '',
  dataDogRumApplicationId: '',
};

/**
 * Initialize runtime configuration from server context to TransferState
 * This runs during app initialization and makes config available to other providers
 */
async function initializeRuntimeConfig(): Promise<void> {
  const transferState = inject(TransferState);
  const reqContext = inject(REQUEST_CONTEXT, { optional: true }) as {
    runtimeConfig: RuntimeConfig;
  } | null;

  // Server-side: Store config to TransferState for browser hydration
  if (reqContext?.runtimeConfig) {
    transferState.set(RUNTIME_CONFIG_KEY, reqContext.runtimeConfig);
  }
}

/**
 * Provider for runtime configuration initialization
 * Must be included before other providers that depend on runtime config (feature flags, DataDog, etc.)
 */
export const provideRuntimeConfig = (): EnvironmentProviders => provideAppInitializer(initializeRuntimeConfig);

/**
 * Helper function to get runtime config from TransferState
 * Can be used by other providers/services during initialization
 */
export function getRuntimeConfig(transferState: TransferState): RuntimeConfig {
  return transferState.get(RUNTIME_CONFIG_KEY, DEFAULT_RUNTIME_CONFIG);
}
