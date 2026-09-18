// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EnvironmentProviders, inject, provideAppInitializer, TransferState } from '@angular/core';
import { datadogRum } from '@datadog/browser-rum';
import { environment } from '@environments/environment';

import { redactAuthFragment } from '@lfx-one/shared/utils';

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

  const { dataDogRumApplicationId, dataDogRumClientId, allowedTracingUrls } = runtimeConfig;

  // Skip if not configured (both applicationId and clientToken required)
  if (!dataDogRumApplicationId || !dataDogRumClientId) {
    console.warn('DataDog RUM not configured - monitoring disabled');
    return;
  }

  try {
    datadogRum.init({
      applicationId: dataDogRumApplicationId,
      clientToken: dataDogRumClientId,
      // RUM's first view event captures window.location.href as it is at startup, and the
      // Gatewaze embed's LFID sign-in returns to `#access_token=…&refresh_token=…`. The component
      // that clears that fragment runs in afterNextRender, long after this initializer, so without
      // redaction here a Supabase access AND refresh token reach a third-party analytics sink.
      //
      // Redacting here rather than clearing the address bar before init, which is the more obvious
      // fix and is wrong: GwModuleOutletComponent.adoptAuthFragment reads window.location.hash to
      // establish the embed session, so clearing it early would stop the tokens reaching Datadog
      // by breaking sign-in altogether. The fragment must survive in the address bar until the
      // outlet consumes it; what must not happen is RUM reporting it.
      //
      // Covers the referrer too, which carries the previous URL and would otherwise leak the same
      // fragment on the next view.
      beforeSend: (event) => {
        const view = (event as { view?: { url?: string; referrer?: string } }).view;
        if (view?.url) {
          view.url = redactAuthFragment(view.url, window.location.origin);
        }
        if (view?.referrer) {
          view.referrer = redactAuthFragment(view.referrer, window.location.origin);
        }
        return true;
      },
      site: environment.datadog.site,
      service: environment.datadog.service,
      env: environment.datadog.env,
      sessionSampleRate: environment.datadog.env ? 100 : 0,
      sessionReplaySampleRate: environment.datadog.env ? 100 : 0,
      trackUserInteractions: environment.datadog.env ? true : false,
      trackResources: environment.datadog.env ? true : false,
      trackLongTasks: environment.datadog.env ? true : false,
      defaultPrivacyLevel: 'allow',
      traceSampleRate: environment.datadog.env ? 100 : 0,
      allowedTracingUrls: allowedTracingUrls.map((url) => ({
        match: url.replace(/\/+$/, ''),
        propagatorTypes: ['tracecontext' as const],
      })),
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
