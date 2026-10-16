// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, inject, Injectable, PLATFORM_ID, TransferState } from '@angular/core';
import { GW_EMBED_HOST_SESSION_ME_URL, GW_EMBED_NAV_LINK_PATHS } from '@lfx-one/shared/constants';

import { getRuntimeConfig } from '../providers/runtime-config.provider';
import { UserService } from './user.service';

/**
 * Starts the slow parts of opening the Gatewaze embed before the embed asks for them.
 *
 * Two things dominate the wait between the LFX skeleton and the embed's first paint:
 *
 * - The first `/api/gatewaze/session/me` of an LFX session mints a Gatewaze session on the server
 *   (an Auth0 refresh, GoTrue's ID token grant and the admin check). The embed only asks for it after
 *   the loader has fetched the manifest and the bundle, so that cost is paid in series.
 *   `warmSession` sends the same request early and drops the answer. The server's session store
 *   lets one caller mint per session and makes the others wait on its create lock, then read what
 *   it stored, so the embed's own request finds the warmed session instead of minting a second one.
 * - The loader's requests to `GW_EMBED_URL` start on a cold connection. `preconnect` adds a
 *   `<link rel="preconnect">` and `dns-prefetch` for that origin. It runs during SSR too, so a page
 *   rendered on an embed route carries the hint in its HTML.
 *
 * Both are idempotent, and the session warm-up runs at most once per page session. Nothing here
 * ever blocks on the warm-up or reads its result; a failure costs nothing but the request.
 */
@Injectable({ providedIn: 'root' })
export class GwEmbedWarmupService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly transferState = inject(TransferState);
  private readonly userService = inject(UserService);

  private sessionWarmed = false;

  /**
   * Fires one background `/session/me`, exactly as the embed's host-session shim sends it
   * (`credentials: 'include'` and the anon key as `apikey`), and ignores the answer. Browser only.
   * Skipped when host-session mode is off or incomplete, or while impersonating (the route answers
   * 403 then and never mints).
   */
  public warmSession(): void {
    if (this.sessionWarmed || !isPlatformBrowser(this.platformId) || this.userService.impersonating()) {
      return;
    }
    const config = getRuntimeConfig(this.transferState);
    if (!config.gwHostSession || !config.gwSupabaseAnonKey) {
      return;
    }
    this.sessionWarmed = true;
    try {
      void fetch(GW_EMBED_HOST_SESSION_ME_URL, { credentials: 'include', headers: { apikey: config.gwSupabaseAnonKey } }).then(
        // Release the body; the answer itself is never read.
        (response) => response.body?.cancel().catch(() => undefined),
        () => undefined
      );
    } catch {
      // A synchronous fetch failure (a stubbed or missing fetch) is as ignorable as a failed request.
    }
  }

  /**
   * Adds `preconnect` and `dns-prefetch` hints for the `GW_EMBED_URL` origin, once per document.
   * Safe on the server: it only touches the injected `DOCUMENT`, so during SSR the hints land in
   * the rendered `<head>`.
   *
   * `crossorigin` because the loader's manifest fetch and its module import of the bundle are both
   * CORS requests without credentials, which the browser sends on a separate, anonymous connection;
   * a hint without it would warm a connection those requests cannot use.
   */
  public preconnect(): void {
    const config = getRuntimeConfig(this.transferState);
    if (!config.gwHostSession || !config.gwEmbedUrl) {
      return;
    }
    let origin: string;
    try {
      origin = new URL(config.gwEmbedUrl).origin;
    } catch {
      return;
    }
    const head = this.document.head;
    if (!head || head.querySelector(`link[rel="preconnect"][data-gw-embed-hint]`)) {
      return;
    }
    const preconnect = this.document.createElement('link');
    preconnect.setAttribute('rel', 'preconnect');
    preconnect.setAttribute('href', origin);
    preconnect.setAttribute('crossorigin', '');
    preconnect.setAttribute('data-gw-embed-hint', '');
    const dnsPrefetch = this.document.createElement('link');
    dnsPrefetch.setAttribute('rel', 'dns-prefetch');
    dnsPrefetch.setAttribute('href', origin);
    dnsPrefetch.setAttribute('data-gw-embed-hint', '');
    head.appendChild(preconnect);
    head.appendChild(dnsPrefetch);
  }

  /**
   * Warms the session and the connection when the pointer or focus reaches a sidebar link that opens
   * the embed. The link only renders for users who would see the embed (the pilot flag, the tenant
   * allowlist and newsletter access), so its presence is the audience check. Delegated on `host`,
   * so the sidebar's item loops need no per-link wiring, and removed after the first hit.
   */
  public watchNavIntent(host: HTMLElement, destroyRef: DestroyRef): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const onIntent = (event: Event): void => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || !GW_EMBED_NAV_LINK_PATHS.includes(new URL(anchor.href, this.document.baseURI).pathname)) {
        return;
      }
      stop();
      this.preconnect();
      this.warmSession();
    };
    const stop = (): void => {
      host.removeEventListener('pointerover', onIntent);
      host.removeEventListener('focusin', onIntent);
    };
    host.addEventListener('pointerover', onIntent);
    host.addEventListener('focusin', onIntent);
    destroyRef.onDestroy(stop);
  }
}
