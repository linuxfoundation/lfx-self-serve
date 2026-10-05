// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, EnvironmentProviders, inject, provideAppInitializer, TransferState } from '@angular/core';
import { Event, NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, NavigationStart, Router, RoutesRecognized } from '@angular/router';
import { datadogRum } from '@datadog/browser-rum';
import { environment } from '@environments/environment';
import { fromEvent, Observable, Subscription } from 'rxjs';

import { CREDENTIAL_REDACTION_MARKER } from '@lfx-one/shared/constants';
import { redactAuthFragment, redactInviteToken, redactMeetingPassword, redactMeetingPasswordInText } from '@lfx-one/shared/utils';

import { getRuntimeConfig } from './runtime-config.provider';

/**
 * Redacts every credential a URL can carry into Datadog: an auth fragment, an invite `?token=` and
 * a meeting passcode. Returns the URL unchanged when it carries none.
 *
 * @param url Absolute or relative URL.
 * @param origin Origin a relative URL is resolved against.
 */
export function redactRumUrl(url: string, origin: string): string {
  return redactMeetingPassword(redactInviteToken(redactAuthFragment(url, origin), origin), origin);
}

/**
 * Whether Session Replay may record while the address bar shows `url`. Replay records
 * `window.location.href` verbatim at the start of each recording and of each view, outside
 * `beforeSend`, so it must not run at all while the URL carries a credential.
 *
 * A credential whose value already equals the redaction marker comes back from `redactRumUrl`
 * unchanged, so a URL containing the marker anywhere is refused too. That fails closed: at worst a
 * clean page that happens to mention the word is not recorded.
 */
export function shouldRecordReplay(url: string, origin: string): boolean {
  return redactRumUrl(url, origin) === url && !url.toLowerCase().includes(CREDENTIAL_REDACTION_MARKER);
}

/**
 * Records Session Replay only while the URL carries no credential (see `shouldRecordReplay`).
 *
 * Stops before the URL changes: on `NavigationStart` / `RoutesRecognized` when the target (or its
 * redirect) carries a credential, and on a history traversal (`popState`) once the browser has
 * already moved to such a URL. The caller must subscribe `popState` in the capture phase before
 * RUM starts, so this runs ahead of RUM's own listener, which records the new view. Once a
 * navigation settles, recording follows the URL actually shown. A URL change made outside the
 * router leaves the state as it was until the next navigation; it can only remove a credential
 * (the embed clearing its auth fragment), so replay stays stopped meanwhile.
 *
 * @param routerEvents The router's event stream.
 * @param popState Emits on every `popstate`, after the browser has moved to the new URL.
 * @param origin Origin a relative URL is resolved against.
 * @param replay The start/stop half of the RUM public API.
 * @param currentUrl Returns the URL currently in the address bar.
 */
export function gateReplayRecording(
  routerEvents: Observable<Event>,
  popState: Observable<unknown>,
  origin: string,
  replay: Pick<typeof datadogRum, 'startSessionReplayRecording' | 'stopSessionReplayRecording'>,
  currentUrl: () => string
): Subscription {
  const sync = (): void => {
    if (shouldRecordReplay(currentUrl(), origin)) {
      replay.startSessionReplayRecording();
    } else {
      replay.stopSessionReplayRecording();
    }
  };
  const stopFor = (url: string): void => {
    if (!shouldRecordReplay(url, origin)) {
      replay.stopSessionReplayRecording();
    }
  };

  const subscription = popState.subscribe(() => stopFor(currentUrl()));
  subscription.add(
    routerEvents.subscribe((event) => {
      if (event instanceof NavigationStart) {
        stopFor(event.url);
      } else if (event instanceof RoutesRecognized) {
        stopFor(event.urlAfterRedirects);
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError ||
        event instanceof NavigationSkipped
      ) {
        sync();
      }
    })
  );
  sync();
  return subscription;
}

/**
 * Redacts, in place, every credential a Datadog RUM event can carry: an auth fragment, an invite
 * `?token=` and a meeting passcode in each modifiable URL field, and a meeting passcode quoted in
 * the free-text error and long-task fields. The `beforeSend` hook below calls it on every event;
 * exported so a spec can drive representative events through the same wiring.
 *
 * @param event A RUM event; fields it does not carry are skipped.
 * @param origin Origin a relative URL is resolved against.
 */
export function redactRumEvent(event: object, origin: string): void {
  const redact = (url: string): string => redactRumUrl(url, origin);
  const {
    view,
    resource,
    error,
    long_task: longTask,
  } = event as {
    view?: { url?: string; referrer?: string; performance?: { lcp?: { resource_url?: string } } };
    resource?: { url?: string };
    error?: { message?: string; stack?: string; resource?: { url?: string } };
    long_task?: { scripts?: { source_url?: string; invoker?: string }[] };
  };
  if (view?.url) {
    view.url = redact(view.url);
  }
  if (view?.referrer) {
    view.referrer = redact(view.referrer);
  }
  if (view?.performance?.lcp?.resource_url) {
    view.performance.lcp.resource_url = redact(view.performance.lcp.resource_url);
  }
  if (resource?.url) {
    resource.url = redact(resource.url);
  }
  if (error?.resource?.url) {
    error.resource.url = redact(error.resource.url);
  }
  if (error?.message) {
    error.message = redactMeetingPasswordInText(error.message);
  }
  if (error?.stack) {
    error.stack = redactMeetingPasswordInText(error.stack);
  }
  for (const script of longTask?.scripts ?? []) {
    if (script.source_url) {
      script.source_url = redact(script.source_url);
    }
    if (script.invoker) {
      script.invoker = redactMeetingPasswordInText(script.invoker);
    }
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

  const router = inject(Router);
  const destroyRef = inject(DestroyRef);

  try {
    // Session Replay is started manually (startSessionReplayRecordingManually below) and only while
    // the URL carries no credential: replay records the page URL verbatim, outside beforeSend. The
    // gate is set up before init so its capture-phase popstate listener runs ahead of RUM's; a start
    // or stop issued before init is applied when RUM starts.
    const replayGate = gateReplayRecording(
      router.events,
      fromEvent(window, 'popstate', { capture: true }),
      window.location.origin,
      datadogRum,
      () => window.location.href
    );
    destroyRef.onDestroy(() => replayGate.unsubscribe());

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
      //
      // Invite landing puts a single-factor accept credential in `?token=` rather than the hash.
      // redactAuthFragment does not touch the query string, so redactInviteToken runs after it.
      //
      // Meeting join links carry the private/restricted-meeting passcode in `?password=` on any
      // path, so redactMeetingPassword runs too — on every other modifiable URL field as well
      // (trackResources records the initial document load; LCP and long-task script attribution
      // can name the page URL), and on free-text error/long-task fields that may quote a URL.
      //
      // beforeSend does not see Session Replay records, which is why replay is gated above.
      beforeSend: (event) => {
        redactRumEvent(event, window.location.origin);
        return true;
      },
      site: environment.datadog.site,
      service: environment.datadog.service,
      env: environment.datadog.env,
      sessionSampleRate: environment.datadog.env ? 100 : 0,
      sessionReplaySampleRate: environment.datadog.env ? 100 : 0,
      startSessionReplayRecordingManually: true,
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
