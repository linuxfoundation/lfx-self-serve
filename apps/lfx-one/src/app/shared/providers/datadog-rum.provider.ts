// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EnvironmentProviders, inject, provideAppInitializer, TransferState } from '@angular/core';
import { datadogRum } from '@datadog/browser-rum';
import { environment } from '@environments/environment';

import { getRuntimeConfig } from './runtime-config.provider';

/**
 * Initialize DataDog RUM for browser monitoring
 * Only runs in browser environment - relies on runtime config being set up first
 */
async function initializeDataDogRum(): Promise<void> {
  // Skip on server - DataDog RUM is browser-only
  if (typeof window === 'undefined') {
    return;
  }

  const transferState = inject(TransferState);
  const runtimeConfig = getRuntimeConfig(transferState);

  const { dataDogRumApplicationId, dataDogRumClientId } = runtimeConfig;

  // Skip if not configured (both applicationId and clientToken required)
  if (!dataDogRumApplicationId || !dataDogRumClientId) {
    console.warn('DataDog RUM not configured - monitoring disabled');
    return;
  }

  try {
    datadogRum.init({
      applicationId: dataDogRumApplicationId,
      clientToken: dataDogRumClientId,
      site: environment.datadog.site,
      service: environment.datadog.service,
      env: environment.datadog.env,
      sessionSampleRate: environment.datadog.env ? 100 : 0,
      sessionReplaySampleRate: environment.datadog.env ? 100 : 0,
      trackUserInteractions: environment.datadog.env ? true : false,
      trackResources: environment.datadog.env ? true : false,
      trackLongTasks: environment.datadog.env ? true : false,
      defaultPrivacyLevel: 'allow',
    });
  } catch (error) {
    console.error('Failed to initialize DataDog RUM:', error);
    // App continues without RUM monitoring
  }
}

/**
 * Provider for DataDog RUM initialization
 * Note: provideRuntimeConfig() must be included before this provider
 */
export const provideDataDogRum = (): EnvironmentProviders => provideAppInitializer(initializeDataDogRum);
