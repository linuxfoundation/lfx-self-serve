// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EnvironmentProviders, inject, provideAppInitializer, TransferState } from '@angular/core';
import { environment } from '@environments/environment';
import { LaunchDarklyClientProvider } from '@openfeature/launchdarkly-client-provider';
import { OpenFeature } from '@openfeature/web-sdk';
import { basicLogger } from 'launchdarkly-js-client-sdk';

import { getRuntimeConfig } from './runtime-config.provider';

/**
 * Initialize OpenFeature with LaunchDarkly provider
 * Only runs in browser environment - relies on runtime config being set up first
 */
async function initializeOpenFeature(): Promise<void> {
  // Skip on server - LaunchDarkly is browser-only
  if (typeof window === 'undefined') {
    return;
  }

  const transferState = inject(TransferState);
  const runtimeConfig = getRuntimeConfig(transferState);
  const clientId = runtimeConfig.launchDarklyClientId;

  // Skip if no client ID is configured
  if (!clientId) {
    console.warn('LaunchDarkly client ID not configured - feature flags disabled');
    return;
  }

  try {
    const provider = new LaunchDarklyClientProvider(clientId, {
      initializationTimeout: 5,
      streaming: true,
      logger: basicLogger({ level: environment.production ? 'none' : 'info' }),
    });

    await OpenFeature.setProviderAndWait(provider);
  } catch (error) {
    console.error('Failed to initialize OpenFeature with LaunchDarkly:', error);
    // App continues without feature flags
  }
}

/**
 * Provider for OpenFeature/LaunchDarkly initialization
 * Note: provideRuntimeConfig() must be included before this provider
 */
export const provideFeatureFlags = (): EnvironmentProviders => provideAppInitializer(initializeOpenFeature);
