// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EnvironmentProviders, inject, provideAppInitializer, TransferState } from '@angular/core';
import { environment } from '@environments/environment';
import { FEATURE_FLAG_READY_TIMEOUT_MS } from '@lfx-one/shared';
import { LaunchDarklyClientProvider } from '@openfeature/launchdarkly-client-provider';
import { OpenFeature } from '@openfeature/web-sdk';
import { basicLogger } from 'launchdarkly-js-client-sdk';

import { DataDogRumService } from '../services/datadog-rum.service';
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

  // Injected before the first `await` — inject() needs the active injection context, which this
  // app-initializer callback only holds synchronously.
  const dataDogRumService = inject(DataDogRumService);
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
      // Shares FEATURE_FLAG_READY_TIMEOUT_MS with FeatureFlagService.waitForReady() (GH-1351
      // follow-up) so the bootstrap wait and every guard's post-bootstrap wait use one tunable
      // budget instead of two independent magic numbers. This SDK option takes seconds.
      initializationTimeout: FEATURE_FLAG_READY_TIMEOUT_MS / 1000,
      streaming: true,
      logger: basicLogger({ level: environment.production ? 'none' : 'info' }),
    });

    await OpenFeature.setProviderAndWait(provider);
  } catch (error) {
    console.error('Failed to initialize OpenFeature with LaunchDarkly:', error);
    // App continues without feature flags — but the provider never reaches READY, so every
    // flag-gated guard will independently wait out its own timeout later (GH-1351). Report here
    // too so the bootstrap failure itself is visible, not just each guard's downstream timeout.
    dataDogRumService.addError(error instanceof Error ? error : new Error(String(error)), { source: 'initializeOpenFeature' });
  }
}

/**
 * Provider for OpenFeature/LaunchDarkly initialization
 * Note: provideRuntimeConfig() must be included before this provider
 */
export const provideFeatureFlags = (): EnvironmentProviders => provideAppInitializer(initializeOpenFeature);
