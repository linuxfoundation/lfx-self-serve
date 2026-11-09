// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable, signal } from '@angular/core';
import { INTERCOM_CUSTOM_LAUNCHER_SELECTOR, PHONE_MEDIA_QUERY } from '@lfx-one/shared/constants';
import { IntercomBootOptions, IntercomFunction, IntercomSettings } from '@lfx-one/shared/interfaces';
import { redactInviteToken } from '@lfx-one/shared/utils';

import { DataDogRumService } from './datadog-rum.service';

// Browser-only widget; every method is a no-op during SSR.
@Injectable({
  providedIn: 'root',
})
export class IntercomService {
  // Read by openMessenger() to decide whether an on-demand anonymous boot is needed first.
  // Set synchronously when boot() is called; the stub queue absorbs commands until the script loads.
  public isBootRequested = false;

  // True when this boot is on a phone-width viewport and Intercom's default launcher is replaced by
  // the shell's compact support launcher (SupportLauncherComponent). Decided once per boot — Intercom
  // only documents launcher attributes at boot, so there is no runtime update() toggle to throttle.
  // A viewport that crosses the phone breakpoint after boot (rotation) keeps the boot-time choice.
  public readonly customLauncherActive = signal(false);

  private readonly dataDogRumService = inject(DataDogRumService);

  private isLoaded = false;

  private scriptElement: HTMLScriptElement | null = null;

  // Whether a surface has asked for the default launcher bubble to be hidden (see setLauncherHidden).
  private launcherHidden = false;

  // The launcher choice boot() made — an explicit `hide_default_launcher` or the phone replacement —
  // which setLauncherHidden(false) restores rather than forcing the bubble back.
  private bootHidesLauncher = false;

  // Identity for an on-demand boot when the startup boot was skipped — the invite landing skips it
  // to keep first paint off Intercom, but its "Contact support" CTA must still reach support as the
  // signed-in user (GH-2290). Only AppComponent sets this, and never while impersonating: the
  // impersonation override rewrites the identity claims but not the Intercom JWT claim, so a boot
  // built from `UserService.user()` there would pair the operator's JWT with the target's PII.
  private identity: IntercomBootOptions | null = null;

  // Invoked from the widget script's onerror when set by a click-triggered openMessenger() —
  // lets support CTAs surface a toast on load failure while startup boot stays silent.
  private onLoadError?: () => void;

  // Fire-and-forget: stub queue absorbs calls before the script loads and replays them on load.
  public boot(options: IntercomBootOptions): void {
    if (typeof window === 'undefined') {
      return;
    }
    if (!options.app_id) {
      console.warn('Intercom: boot called without app_id');
      return;
    }
    if (this.isBootRequested) {
      console.info('Intercom: boot ignored — already requested');
      return;
    }

    // Intercom records the page URL. On an invite page that carries the signed token, so swap in the
    // redacted URL first; the page already holds the token, and replaceState does not re-route.
    const redactedUrl = redactInviteToken(window.location.href);
    if (redactedUrl !== window.location.href) {
      window.history.replaceState(window.history.state, '', redactedUrl);
    }

    // Phones get the compact shell launcher instead of Intercom's default bubble, which covers row
    // actions and sticky bars (#4865). Desktop boots exactly as before.
    const launcherSettings = this.launcherSettings();
    this.customLauncherActive.set(Object.keys(launcherSettings).length > 0);
    this.bootHidesLauncher = options.hide_default_launcher === true || this.customLauncherActive();
    // A boot that lands while a surface has the bubble hidden must not bring it back (#5416).
    const bootLauncherSettings: IntercomSettings =
      this.launcherHidden && !this.customLauncherActive() ? { ...launcherSettings, hide_default_launcher: true } : launcherSettings;

    this.loadIntercomScript(options.app_id, options.api_base, bootLauncherSettings);
    window.Intercom!('boot', { ...options, ...bootLauncherSettings });
    this.isBootRequested = true;
    console.info('Intercom: boot command dispatched to widget');
  }

  public show(): void {
    if (typeof window === 'undefined' || !window.Intercom || !this.isBootRequested) {
      return;
    }
    window.Intercom('show');
  }

  // Re-scan the DOM so the widget (re)binds custom launchers that entered the page after boot —
  // e.g. the profile help link, which is router-mounted on client-side navigation into /profile/*.
  // Fire-and-forget: pre-load, the stub queues the calls and replays them once the script boots.
  public update(): void {
    if (typeof window === 'undefined' || !window.Intercom || !this.isBootRequested) {
      return;
    }
    this.reattachAndUpdate(window.Intercom);
  }

  // Hides or restores the default launcher bubble for a surface whose bottom-right controls it would
  // cover, like the meeting composer drawer's footer (#5416). Uses Intercom's own
  // `hide_default_launcher` setting rather than CSS on the widget's internal markup. Restoring goes
  // back to the boot-time choice, so a boot that hid the bubble explicitly keeps it hidden.
  // Phones are left alone entirely: a phone boot already swaps the bubble for the compact shell
  // launcher (#4865), so no Intercom command is sent there.
  // The value is mirrored on `intercomSettings` because update() replays those settings, and before
  // boot it is only recorded for boot() to apply.
  public setLauncherHidden(hidden: boolean): void {
    if (typeof window === 'undefined' || this.launcherHidden === hidden) {
      return;
    }
    this.launcherHidden = hidden;
    if (this.customLauncherActive()) {
      return;
    }
    const hideDefaultLauncher = hidden || this.bootHidesLauncher;
    if (window.intercomSettings) {
      window.intercomSettings.hide_default_launcher = hideDefaultLauncher;
    }
    if (window.Intercom && this.isBootRequested) {
      window.Intercom('update', { hide_default_launcher: hideDefaultLauncher });
    }
  }

  // Records who a later on-demand boot should identify as, without loading the widget.
  public setIdentity(options: IntercomBootOptions): void {
    this.identity = options;
  }

  // Entry point for support CTAs: boots Intercom on demand when startup boot was skipped
  // (impersonation, public pages, missing JWT claim, invite landing). Uses the staged identity
  // when one was recorded, otherwise boots anonymously with `{ app_id }`.
  // Fire-and-forget — a fresh boot queues behind the stub and replays before show on script load.
  // onLoadError fires if the widget script fails to load (e.g. ad-blockers) — including a click
  // landing while a startup boot is still in flight. It is never registered by page-load boots
  // and is cleared once the script loads, so ad-blocked users are only toasted after a click.
  public openMessenger(appId: string, onLoadError?: () => void): void {
    if (!this.isBootRequested) {
      this.boot(this.identity ?? { app_id: appId });
    }
    if (!this.isLoaded) {
      this.onLoadError = onLoadError;
    }
    this.show();
  }

  // Call on logout, before the page navigates away (LogoutLinkDirective), and before re-booting
  // with a different user (impersonation identity reset).
  public shutdown(): void {
    // Dropped unconditionally: the stale identity must not survive into the next boot even when
    // there is no widget to shut down.
    this.identity = null;
    this.customLauncherActive.set(false);
    this.bootHidesLauncher = false;
    if (typeof window === 'undefined') {
      return;
    }
    if (window.Intercom && this.isBootRequested) {
      window.Intercom('shutdown');
      this.isBootRequested = false;
    }
  }

  // Launcher attributes for a phone-width boot; empty on desktop and during SSR. Both attributes are
  // documented Intercom messenger settings read at boot: the default bubble is hidden and the
  // shell's own button (matched by selector) opens the messenger instead.
  private launcherSettings(): IntercomSettings {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return {};
    }
    if (!window.matchMedia(PHONE_MEDIA_QUERY).matches) {
      return {};
    }
    return { hide_default_launcher: true, custom_launcher_selector: INTERCOM_CUSTOM_LAUNCHER_SELECTOR };
  }

  private loadIntercomScript(appId: string, apiBase?: string, launcherSettings: IntercomSettings = {}): void {
    if (this.isLoaded || typeof window === 'undefined') {
      return;
    }

    const scriptSrc = `https://widget.intercom.io/widget/${appId}`;
    if (this.scriptElement?.isConnected || document.querySelector(`script[src="${scriptSrc}"]`)) {
      return;
    }

    window.intercomSettings = {
      api_base: apiBase || 'https://api-iam.intercom.io',
      app_id: appId,
      ...launcherSettings,
    };

    this.initializeIntercomFunction();

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src = scriptSrc;
    this.scriptElement = script;

    script.onload = () => {
      this.isLoaded = true;
      this.onLoadError = undefined;
      console.info('Intercom: widget script loaded');
    };

    script.onerror = (error) => {
      this.isBootRequested = false;
      // No widget will bind the custom launcher, so drop it rather than leave a dead button.
      this.customLauncherActive.set(false);
      script.remove();
      this.scriptElement = null;
      // Drop the stub and settings so a retry boots from a genuinely fresh queue — otherwise the
      // failed attempt's boot/show commands replay alongside the retry's (the queue is unreachable
      // anyway once the only script that would drain it has failed).
      delete window.Intercom;
      delete window.intercomSettings;
      console.error('Intercom: failed to load widget script', error);
      // Surface to RUM so sessions where the Fin messenger cannot open are dashboardable.
      this.dataDogRumService.addError(new Error('Intercom script failed to load'), { context: 'intercom_load' });
      this.onLoadError?.();
      this.onLoadError = undefined;
    };

    const firstScript = document.getElementsByTagName('script')[0];
    if (firstScript && firstScript.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      document.head.appendChild(script);
    }
  }

  // `reattach_activator` is the (re)bind command — `update` alone only refreshes user/page data —
  // and the pair order mirrors the official Intercom snippet. Shared by the boot-time rebind in
  // initializeIntercomFunction() and the post-boot rebind in update() so the two can never desync.
  private reattachAndUpdate(ic: IntercomFunction): void {
    ic('reattach_activator');
    ic('update', window.intercomSettings!);
  }

  private initializeIntercomFunction(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const ic = window.Intercom;

    if (typeof ic === 'function') {
      this.reattachAndUpdate(ic);
    } else {
      const stub: IntercomFunction = Object.assign(
        (...args: unknown[]) => {
          stub.c?.(args);
        },
        { q: [] as unknown[][], c: (args: unknown[]) => stub.q!.push(args) }
      );
      window.Intercom = stub;
    }
  }
}
