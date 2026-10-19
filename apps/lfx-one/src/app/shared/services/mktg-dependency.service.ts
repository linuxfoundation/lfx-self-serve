// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, HttpStatusCode } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { BRAND_KIT_INTAKE, MKTG_AGENT_INTAKES } from '@lfx-one/shared/constants';
import { BrandKitRevision, MktgDependencyDocument, MktgRevisionFormat } from '@lfx-one/shared/interfaces';
import { readBrandKitRevision, readFoundationMessageContent, renderFoundationMessageMarkdown } from '@lfx-one/shared/utils';
import { catchError, forkJoin, map, Observable, of, Subject, switchMap, throwError } from 'rxjs';

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
 * agent's own registered `endpoints.stored` — so every agent with a registered
 * stored read endpoint is reachable from any browser, not just the Brand Kit
 * (persisting alone is not enough: ICP persists today but registers no read
 * endpoint yet, so it resolves from this browser only). That
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
   *
   * `withSidecar`: the server's LATEST stored revision read with its date
   * and its sidecar JSON, which a `json` attachment submits (the Brand Kit's
   * messaging framework — the latest regardless of its review status, since
   * LFX One has no Approve action yet; Approve is a later item). There is
   * no browser fallback then — a browser-stored run carries no sidecar —
   * and an agent with no stored read endpoint resolves to null. Only a 404
   * is "no revision": any other failure (403, a 5xx, the network) is logged
   * and rethrown, because a null here reads as a measured absence — "Run
   * the messaging framework first" — and the run page must show a failed
   * check instead.
   */
  public resolveDependency(projectUid: string, agentId: string, withSidecar = false): Observable<MktgDependencyDocument | null> {
    const storedEndpoint = MKTG_AGENT_INTAKES[agentId]?.endpoints.stored;
    if (withSidecar) {
      if (!storedEndpoint) {
        return of(null);
      }
      return this.artifactService.getStored(storedEndpoint, projectUid, true).pipe(
        map(
          (stored): MktgDependencyDocument => ({
            agentId,
            source: 'server',
            // The chip names the revision attached as Documents numbers it; the receipt's version is the agent's draft version within its run.
            version: stored.revisionNumber ?? stored.receipt.version,
            // The document is Markdown like on every read; what a `json` attachment submits is the sidecar, untouched.
            // A JSON revision with no Markdown reading still answers: the gate reads the sidecar, not this.
            document: this.markdownOf(stored.documentMarkdown, stored.format) ?? '',
            ...(stored.storedAt && { storedAt: stored.storedAt }),
            ...(stored.sidecar && { sidecar: stored.sidecar }),
          })
        ),
        catchError((error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === HttpStatusCode.NotFound) {
            return of(null);
          }
          console.error('[mktg-dependency] latest revision read failed', { agentId, projectUid, error });
          return throwError(() => error);
        })
      );
    }
    const browserFallback$ = of(this.loadBrowserDocument(projectUid, agentId));
    if (!storedEndpoint) {
      // No stored read endpoint is registered for this agent — browser-stored
      // run only. This is not the same as "persists nothing": an intake can
      // set `persistsDocument` (ICP does) while its `/stored` read endpoint
      // has not shipped yet. Registering `endpoints.stored` on the intake is
      // what lights up the server source here, not a change to this service.
      return browserFallback$;
    }
    return this.artifactService.getStored(storedEndpoint, projectUid).pipe(
      switchMap((stored): Observable<MktgDependencyDocument | null> => {
        const document = this.markdownOf(stored.documentMarkdown, stored.format);
        // Stored JSON that is not a framework has no Markdown reading: the browser copy, like any other miss.
        return document === null ? browserFallback$ : of({ agentId, source: 'server', version: stored.receipt.version, document });
      }),
      catchError(() => browserFallback$)
    );
  }

  /**
   * The project's stored Brand Kit — its latest revision, read from the
   * revision's sidecar — or null when the project has none. A print of
   * another asset (Download PDF) is set in the kit's colours, typeface and
   * logo when there is one, and in the LF look otherwise; so here, unlike a
   * gate, any failed read (403, a 5xx, the network) is also null: the
   * document still prints, in the LF look.
   */
  public resolveBrandKit(projectUid: string): Observable<BrandKitRevision | null> {
    if (!projectUid) {
      return of(null);
    }
    return this.resolveDependency(projectUid, BRAND_KIT_INTAKE.agentId, true).pipe(
      map((document) => readBrandKitRevision(document?.sidecar ?? null)),
      catchError(() => of(null))
    );
  }

  /**
   * Resolve several dependency agents at once, keyed by agent id. Emits a
   * single complete record (unresolved dependencies map to null); an empty
   * dependency list resolves immediately to an empty record. The ids in
   * `sidecarIds` resolve from the server's latest revision with its sidecar.
   */
  public resolveDependencies(projectUid: string, agentIds: string[], sidecarIds: string[] = []): Observable<Record<string, MktgDependencyDocument | null>> {
    const uniqueIds = [...new Set(agentIds)];
    if (uniqueIds.length === 0) {
      return of({});
    }
    const sidecar = new Set(sidecarIds);
    return forkJoin(
      Object.fromEntries(uniqueIds.map((agentId) => [agentId, this.resolveDependency(projectUid, agentId, sidecar.has(agentId))])) as Record<
        string,
        Observable<MktgDependencyDocument | null>
      >
    );
  }

  /**
   * This browser's stored run for the agent, reduced to its latest version's
   * document. An agent that writes an asset (the Messaging Framework) stores
   * an empty document and the asset beside it, so its document is the
   * asset content read exactly as the server's stored JSON is read
   * ({@link markdownOf}): shape-checked, then rendered to Markdown. Browser
   * storage is not re-validated on load, so the check is what keeps a stale
   * or hand-edited asset from reaching the renderer.
   */
  private loadBrowserDocument(projectUid: string, agentId: string): MktgDependencyDocument | null {
    const run = this.runService.loadRun(projectUid, agentId);
    const latest = run?.versions.at(-1);
    const document = latest?.document || (latest?.asset ? (this.markdownOf(JSON.stringify(latest.asset.content), 'json') ?? '') : '');
    if (!latest || !document) {
      return null;
    }
    return { agentId, source: 'browser', version: latest.version, document };
  }

  /**
   * A stored document as a dependent agent reads it. Every consumer takes a
   * Markdown document (the ICP's `message_foundation_markdown` among them),
   * so a JSON revision — the Messaging Framework's — is rendered to Markdown
   * rather than handed over as JSON text. Null for JSON that is not a
   * framework, which has no Markdown reading.
   */
  private markdownOf(text: string, format: MktgRevisionFormat | undefined): string | null {
    if (format !== 'json') {
      return text;
    }
    const content = readFoundationMessageContent(text);
    return content ? renderFoundationMessageMarkdown(content) : null;
  }
}
