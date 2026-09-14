// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { MktgDependencyDocument } from '@lfx-one/shared/interfaces';
import { catchError, forkJoin, map, Observable, of, Subject } from 'rxjs';

import { BrandKitService } from './brand-kit.service';
import { MktgAgentRunService } from './mktg-agent-run.service';

/**
 * Resolves the stored output documents of Marketing OS dependency agents for
 * one project (dec-agent-dependency-gating). Marketplace gating and intake
 * auto-attachments both consume this: an agent that `dependsOn` another stays
 * disabled until every dependency resolves, and its run submits the resolved
 * documents instead of asking for them.
 *
 * Source order per dependency: the BFF's server-persisted document first
 * (entitlement-gated read endpoint), then this browser's stored run for the
 * same agent as fallback. Server persistence exists only for the Brand Kit
 * today — that source lookup is keyed by agent id here, in one place, so the
 * consumers stay generic.
 */
@Injectable({ providedIn: 'root' })
export class MktgDependencyService {
  private readonly brandKitService = inject(BrandKitService);
  private readonly runService = inject(MktgAgentRunService);

  /** Backs {@link documentsChanged$}; hot and replay-free by design (see below). */
  private readonly documentsChanged = new Subject<string>();

  /**
   * Emits the project uid whose stored agent documents just changed — today,
   * whenever a run completes. Surfaces that resolve dependencies (the
   * marketplace's gating) re-resolve on it, so finishing a Brand Kit unlocks
   * its dependents without a page reload.
   *
   * Deliberately replay-free: a subscriber must never receive a notification
   * that predates it, or the marketplace would re-resolve on first render on
   * top of its own initial resolution and double-fetch every load.
   */
  public readonly documentsChanged$: Observable<string> = this.documentsChanged.asObservable();

  /**
   * Announces that an agent run stored new output for a project, invalidating
   * whatever dependency resolution its consumers are holding. Called when a
   * run completes; no-op when nothing is listening.
   */
  public notifyDocumentsChanged(projectUid: string): void {
    if (!projectUid) {
      return;
    }
    this.documentsChanged.next(projectUid);
  }

  /**
   * Resolve one dependency agent's stored output for a project, or null when
   * neither source has one. Any server error (404 nothing stored, 403 not
   * entitled, transient failure) degrades to the browser-stored fallback.
   */
  public resolveDependency(projectUid: string, agentId: string): Observable<MktgDependencyDocument | null> {
    const browserFallback$ = of(this.loadBrowserDocument(projectUid, agentId));
    if (agentId !== 'brand-kit') {
      // No server persistence for this agent yet — browser-stored run only.
      return browserFallback$;
    }
    return this.brandKitService.getStored(projectUid).pipe(
      map(
        (stored): MktgDependencyDocument => ({
          agentId,
          source: 'server',
          version: stored.receipt.version,
          document: stored.documentMarkdown,
        })
      ),
      catchError(() => browserFallback$)
    );
  }

  /**
   * Resolve several dependency agents at once, keyed by agent id. Emits a
   * single complete record (unresolved dependencies map to null); an empty
   * dependency list resolves immediately to an empty record.
   */
  public resolveDependencies(projectUid: string, agentIds: string[]): Observable<Record<string, MktgDependencyDocument | null>> {
    const uniqueIds = [...new Set(agentIds)];
    if (uniqueIds.length === 0) {
      return of({});
    }
    return forkJoin(
      Object.fromEntries(uniqueIds.map((agentId) => [agentId, this.resolveDependency(projectUid, agentId)])) as Record<
        string,
        Observable<MktgDependencyDocument | null>
      >
    );
  }

  /** This browser's stored run for the agent, reduced to its latest version's document. */
  private loadBrowserDocument(projectUid: string, agentId: string): MktgDependencyDocument | null {
    const run = this.runService.loadRun(projectUid, agentId);
    const latest = run?.versions.at(-1);
    if (!latest?.document) {
      return null;
    }
    return { agentId, source: 'browser', version: latest.version, document: latest.document };
  }
}
