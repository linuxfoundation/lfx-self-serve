// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { IntercomBootOptions, IntercomFunction } from '@lfx-one/shared/interfaces';

import { DataDogRumService } from './datadog-rum.service';

// Browser-only widget; every method is a no-op during SSR.
@Injectable({
  providedIn: 'root',
})
export class IntercomService {
  // Read by OpenIntercomDirective to decide whether to open Intercom or fall back to JIRA.
  // Set synchronously when boot() is called; the stub queue absorbs commands until the script loads.
  public isBootRequested = false;

  private readonly dataDogRumService = inject(DataDogRumService);

  private isLoaded = false;

  // Fire-and-forget: stub queue absorbs calls before the script loads and replays them on load.
  public boot(options: IntercomBootOptions): void {
    if (typeof window === 'undefined' || !options.app_id || this.isBootRequested) {
      return;
    }

    this.loadIntercomScript(options.app_id, options.api_base);
    window.Intercom!('boot', options);
    this.isBootRequested = true;
  }

  public show(): void {
    if (typeof window === 'undefined' || !window.Intercom || !this.isBootRequested) {
      return;
    }
    window.Intercom('show');
  }

  // Call before re-booting with a different user (impersonation identity reset).
  public shutdown(): void {
    if (typeof window === 'undefined') {
      return;
    }
    if (window.Intercom && this.isBootRequested) {
      window.Intercom('shutdown');
      this.isBootRequested = false;
    }
  }

  private loadIntercomScript(appId: string, apiBase?: string): void {
    if (this.isLoaded || typeof window === 'undefined') {
      return;
    }

    window.intercomSettings = {
      api_base: apiBase || 'https://api-iam.intercom.io',
      app_id: appId,
    };

    this.initializeIntercomFunction();

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src = `https://widget.intercom.io/widget/${appId}`;

    script.onload = () => {
      this.isLoaded = true;
    };

    script.onerror = (error) => {
      this.isBootRequested = false;
      console.error('IntercomService: Failed to load script', error);
      // Surface to RUM so "users stuck in Jira fallback" is dashboardable.
      this.dataDogRumService.addError(new Error('Intercom script failed to load'), { context: 'intercom_load' });
    };

    const firstScript = document.getElementsByTagName('script')[0];
    if (firstScript && firstScript.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      document.head.appendChild(script);
    }
  }

  private initializeIntercomFunction(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const ic = window.Intercom;

    if (typeof ic === 'function') {
      ic('reattach_activator');
      ic('update', window.intercomSettings!);
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
