// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID, Signal, signal } from '@angular/core';
import { NewsletterBlockManifestEntry, NewsletterTemplateManifest } from '@lfx-one/shared/interfaces';
import { catchError, finalize, Observable, of, shareReplay, take, tap } from 'rxjs';

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

  // One cached request per template key, shared across subscribers.
  private readonly manifestStreams = new Map<string, Observable<NewsletterTemplateManifest | null>>();

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

  /**
   * Fetch and cache the manifest for a template key. Safe to call repeatedly —
   * the underlying request is shared per key. No-ops on the server (returns an
   * empty manifest stream).
   */
  public load(templateKey: string): Observable<NewsletterTemplateManifest | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return of(null);
    }

    const cached = this.manifestStreams.get(templateKey);
    if (cached) {
      return cached;
    }

    const projectUid = this.projectContext.activeContextUid();
    if (!projectUid) {
      // No project context yet — surface as a load failure the composer can
      // show; nothing is cached, so a later call retries once context exists.
      this.errorSignal.set(true);
      return of(null);
    }

    this.loadingSignal.set(true);
    this.errorSignal.set(false);

    const stream = this.http
      .get<NewsletterTemplateManifest>(`/api/projects/${encodeURIComponent(projectUid)}/newsletters/templates/${encodeURIComponent(templateKey)}/manifest`)
      .pipe(
        tap((manifest) => this.manifestSignal.set(manifest)),
        catchError(() => {
          this.errorSignal.set(true);
          // Reset the cache so a later retry can re-issue the request.
          this.manifestStreams.delete(templateKey);
          return of(null);
        }),
        finalize(() => this.loadingSignal.set(false)),
        shareReplay({ bufferSize: 1, refCount: false })
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
