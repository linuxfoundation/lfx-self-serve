// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EnvironmentProviders, provideAppInitializer } from '@angular/core';
import { LaunchDarklyClientProvider } from '@openfeature/launchdarkly-client-provider';
import { OpenFeature } from '@openfeature/web-sdk';
import { basicLogger } from 'launchdarkly-js-client-sdk';

import { environment } from '../../../environments/environment';

/**
 * Initialize OpenFeature with LaunchDarkly provider
 * Only runs in browser environment
 */
function initializeOpenFeature(): () => Promise<void> {
  return async () => {
    // Skip initialization on server
    if (typeof window === 'undefined') {
      return;
    }

    // Skip if no client ID is configured
    if (!environment.launchDarklyClientId) {
      console.warn('LaunchDarkly client ID not configured - feature flags disabled');
      return;
    }

    try {
      const provider = new LaunchDarklyClientProvider(environment.launchDarklyClientId, {
        initializationTimeout: 5,
        streaming: true,
        logger: basicLogger({ level: environment.production ? 'none' : 'info' }),
      });

      await OpenFeature.setProviderAndWait(provider);
    } catch (error) {
      console.error('Failed to initialize OpenFeature with LaunchDarkly:', error);
      // App continues without feature flags
    }
  };
}

/**
 * Provider for OpenFeature initialization using Angular 19's provideAppInitializer
 */
export const provideFeatureFlags = (): EnvironmentProviders => provideAppInitializer(initializeOpenFeature());
