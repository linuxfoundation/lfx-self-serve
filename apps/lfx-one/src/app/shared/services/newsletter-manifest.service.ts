// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID, Signal, signal } from '@angular/core';
import { NewsletterBlockManifestEntry, NewsletterTemplateInfo, NewsletterTemplatesResponse, NewsletterTemplateManifest } from '@lfx-one/shared/interfaces';
import { catchError, finalize, map, Observable, of, shareReplay, take, tap } from 'rxjs';

import { ProjectContextService } from './project-context.service';

/**
 * Loads the newsletter block manifest for a template set — the palette of
 * block types and their field schemas the block composer renders.
 *
 * Manifests are served by lfx-v2-newsletter-service from the template sets
 * embedded in its binary (GET .../newsletters/templates/{key}/manifest,
 * proxied by the BFF), so the same templates drive the editor palette and the
 * server render — one source of truth, no drift. A manifest changes only when
 * the service is rebuilt, so each key's request is cached for the app's
 * lifetime. The fetch is browser-only: SSR has no use for the editor palette,
 * so load() no-ops on the server and the loaded manifest is exposed as a
 * signal for component consumption.
 */
@Injectable({
  providedIn: 'root',
})
export class NewsletterManifestService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly projectContext = inject(ProjectContextService);

  private readonly manifestSignal = signal<NewsletterTemplateManifest | null>(null);
  private readonly loadingSignal = signal<boolean>(false);
  private readonly errorSignal = signal<boolean>(false);
  // The available template sets (block libraries) the user can pick from. Empty
  // until loaded / on failure — the composer synthesizes a single entry for the
  // active key so its library picker still renders.
  private readonly templatesSignal = signal<NewsletterTemplateInfo[]>([]);

  // One cached request per template key, shared across subscribers.
  private readonly manifestStreams = new Map<string, Observable<NewsletterTemplateManifest | null>>();
  // Keys whose manifest request has RESOLVED (emitted a manifest). A cached
  // stream can still be in flight, and only a resolved key's manifest is safe to
  // expose synchronously — a pending key must keep the loading state until it
  // lands, so a rapid switch back to it (A→B→C→B) can't clear loading and show a
  // stale palette as ready while B is still fetching.
  private readonly resolvedKeys = new Set<string>();
  // The template-catalog request, shared across subscribers once issued.
  private templatesStream: Observable<NewsletterTemplateInfo[]> | null = null;
  // The latest template key any caller requested. Every shared-state write in
  // load() is gated on it, so a slow earlier switch's response can't publish its
  // manifest / loading / error over a newer switch. (The composer's own sequence
  // token guards its LOCAL actions; this guards the SHARED signals.)
  private latestRequestedKey: string | null = null;

  /** Read-only view of the loaded manifest (null until loaded / on failure). */
  public get manifest(): Signal<NewsletterTemplateManifest | null> {
    return this.manifestSignal.asReadonly();
  }

  /** True while the manifest request is in flight. */
  public get loading(): Signal<boolean> {
    return this.loadingSignal.asReadonly();
  }

  /** True when the most recent load attempt failed. */
  public get error(): Signal<boolean> {
    return this.errorSignal.asReadonly();
  }

  /** The available template sets (block libraries), empty until loaded. */
  public get templates(): Signal<NewsletterTemplateInfo[]> {
    return this.templatesSignal.asReadonly();
  }

  /**
   * Fetch and cache the catalog of template sets (block libraries) for the
   * picker. Shared across subscribers; browser-only. On failure (or on the
   * server) it resolves to an empty list — the composer then shows just the
   * active library — rather than surfacing an error, so a missing catalog
   * endpoint never blocks composing.
   */
  public loadTemplates(): Observable<NewsletterTemplateInfo[]> {
    if (!isPlatformBrowser(this.platformId)) {
      return of([]);
    }
    if (this.templatesStream) {
      return this.templatesStream;
    }

    const projectUid = this.projectContext.activeContextUid();
    if (!projectUid) {
      return of([]);
    }

    this.templatesStream = this.http.get<NewsletterTemplatesResponse>(`/api/projects/${encodeURIComponent(projectUid)}/newsletters/templates`).pipe(
      map((response) => response.templates ?? []),
      tap((templates) => this.templatesSignal.set(templates)),
      catchError((err: unknown) => {
        console.warn('NewsletterManifestService: template catalog load failed; picker will show the active library only', { err });
        // Reset so a later call can retry once the endpoint is available.
        this.templatesStream = null;
        return of([]);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.templatesStream;
  }

  /**
   * Fetch and cache the manifest for a template key. Safe to call repeatedly —
   * the underlying request is shared per key. No-ops on the server (returns an
   * empty manifest stream).
   */
  public load(templateKey: string): Observable<NewsletterTemplateManifest | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return of(null);
    }

    // Record this as the latest requested key; the async guards below (`isLatest`)
    // read it at emit time so only the newest switch publishes shared state.
    this.latestRequestedKey = templateKey;
    const isLatest = (): boolean => this.latestRequestedKey === templateKey;

    const cached = this.manifestStreams.get(templateKey);
    if (cached) {
      // A cached stream is a previously-successful or still-in-flight key (a
      // failed load deletes its cache entry). Clear any error a later failed
      // switch/load set, otherwise re-activating a known-good library leaves the
      // palette stuck on the "Could not load" state.
      this.errorSignal.set(false);
      if (this.resolvedKeys.has(templateKey)) {
        // RESOLVED: its manifest replays synchronously to the returned
        // subscription (activating the palette). Clear loading — no new fetch
        // will, and a superseded in-flight fetch's finalize is gated out by
        // isLatest, so it would otherwise stay stuck true forever.
        this.loadingSignal.set(false);
      } else {
        // Still IN FLIGHT: keep the loading state and do NOT expose the previous
        // manifest as ready. The shared stream's tap/finalize activates the
        // palette and clears loading when it lands (gated on this key still being
        // the latest requested), so a rapid switch back can't show a stale palette.
        this.loadingSignal.set(true);
      }
      return cached;
    }

    const projectUid = this.projectContext.activeContextUid();
    if (!projectUid) {
      // No project context yet — surface as a load failure the composer can
      // show; nothing is cached, so a later call retries once context exists.
      // In the wizard flow this does not happen: routing resolves the project
      // context before the composer mounts.
      console.warn('NewsletterManifestService: no active project context; manifest load skipped', { templateKey });
      this.errorSignal.set(true);
      return of(null);
    }

    this.loadingSignal.set(true);
    this.errorSignal.set(false);
    // Clear the now-stale active manifest while the latest uncached load is in
    // flight. Otherwise renderers and field-schema lookups keep consuming the
    // PREVIOUS library's manifest during the fetch, and if this load fails the
    // error path only sets errorSignal — leaving the prior manifest published and
    // breaking the documented "null on failure" contract.
    if (isLatest()) this.manifestSignal.set(null);

    const stream = this.http
      .get<NewsletterTemplateManifest>(`/api/projects/${encodeURIComponent(projectUid)}/newsletters/templates/${encodeURIComponent(templateKey)}/manifest`)
      .pipe(
        catchError((err: unknown) => {
          console.error('NewsletterManifestService: manifest load failed', { templateKey, err });
          if (isLatest()) this.errorSignal.set(true);
          // Reset the cache so a later retry can re-issue the request.
          this.manifestStreams.delete(templateKey);
          return of(null);
        }),
        finalize(() => {
          if (isLatest()) this.loadingSignal.set(false);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
        // Activate this key's manifest AFTER shareReplay, so switching back to an
        // already-loaded key — which replays the cached manifest to the new
        // subscriber without re-running the source — still makes it the active
        // manifest (a tap upstream of shareReplay only runs on the first load).
        // Gated on `isLatest` so a stale switch's response can't overwrite the
        // palette a newer switch already activated.
        tap((manifest) => {
          if (!manifest) return;
          // Mark resolved regardless of isLatest — a key's manifest is available
          // once it lands, even if a newer switch is now active; a later switch
          // back to it can then clear loading synchronously (see the cached branch).
          this.resolvedKeys.add(templateKey);
          if (isLatest()) this.manifestSignal.set(manifest);
        })
      );

    this.manifestStreams.set(templateKey, stream);
    return stream;
  }

  /** Look up a single block manifest entry by its `block_type`. */
  public getBlock(blockType: string): NewsletterBlockManifestEntry | undefined {
    return this.manifestSignal()?.blocks.find((block) => block.block_type === blockType);
  }

  /** Convenience: kick off the load and take a single emission. */
  public ensureLoaded(templateKey: string): Observable<NewsletterTemplateManifest | null> {
    return this.load(templateKey).pipe(take(1));
  }
}
