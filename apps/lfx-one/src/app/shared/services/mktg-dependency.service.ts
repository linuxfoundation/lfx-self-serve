// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { MKTG_AGENT_INTAKES } from '@lfx-one/shared/constants';
import { MktgDependencyDocument } from '@lfx-one/shared/interfaces';
import { catchError, forkJoin, map, Observable, of, Subject } from 'rxjs';

import { MktgAgentRunService } from './mktg-agent-run.service';
import { MktgArtifactService } from './mktg-artifact.service';

/**
 * Resolves the stored output documents of Marketing OS dependency agents for
 * one project (dec-agent-dependency-gating). Marketplace gating and intake
 * auto-attachments both consume this: an agent that `dependsOn` another stays
 * disabled until every dependency resolves, and its run submits the resolved
 * documents instead of asking for them.
 *
 * Source order per dependency: the BFF's server-persisted document first
 * (entitlement-gated read endpoint), then this browser's stored run for the
 * same agent as fallback. The server source is resolved GENERICALLY — from the
 * agent's own registered `endpoints.stored` — so every agent that persists its
 * document is reachable from any browser, not just the Brand Kit. That
 * matters beyond tidiness: a dependency resolvable only from the browser that
 * generated it is not a dependency the project has, and the browser-stored run
 * is TTL-bounded.
 */
@Injectable({ providedIn: 'root' })
export class MktgDependencyService {
  private readonly artifactService = inject(MktgArtifactService);
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
    const storedEndpoint = MKTG_AGENT_INTAKES[agentId]?.endpoints.stored;
    if (!storedEndpoint) {
      // No stored read endpoint is registered for this agent — browser-stored
      // run only. This is not the same as "persists nothing": an intake can
      // set `persistsDocument` (ICP does) while its `/stored` read endpoint
      // has not shipped yet. Registering `endpoints.stored` on the intake is
      // what lights up the server source here, not a change to this service.
      return browserFallback$;
    }
    return this.artifactService.getStored(storedEndpoint, projectUid).pipe(
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
