// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EnvironmentProviders, inject, provideAppInitializer, TransferState } from '@angular/core';
import { datadogRum } from '@datadog/browser-rum';
import { environment } from '@environments/environment';

import { getRuntimeConfig } from './runtime-config.provider';

/**
 * Fragment keys that carry authentication material and must never reach an analytics sink.
 *
 * The Gatewaze embed's LFID sign-in returns to `#access_token=…&refresh_token=…`; a refresh token
 * is long-lived, so this is not a leak that expires on its own.
 */
const AUTH_FRAGMENT_KEYS = ['access_token', 'refresh_token', 'id_token', 'provider_token', 'provider_refresh_token'];

/** Whether a URL fragment carries any of the keys above. */
function hasAuthFragment(hash: string): boolean {
  if (!hash) {
    return false;
  }
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return AUTH_FRAGMENT_KEYS.some((key) => params.has(key));
}

/** Returns `url` with an auth-bearing fragment replaced by a marker, or unchanged if it has none. */
export function redactAuthFragment(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    if (!hasAuthFragment(parsed.hash)) {
      return url;
    }
    // A marker rather than an empty hash, so a reader can tell redaction happened.
    parsed.hash = 'redacted';
    return parsed.toString();
  } catch {
    // Never let redaction throw inside beforeSend — a thrown error there loses the event and can
    // take RUM down with it. An unparseable URL cannot be redacted, so drop the fragment wholesale.
    return url.split('#')[0];
  }
}

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
          view.url = redactAuthFragment(view.url);
        }
        if (view?.referrer) {
          view.referrer = redactAuthFragment(view.referrer);
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
