// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, HttpStatusCode } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { BRAND_KIT_INTAKE, MKTG_AGENT_INTAKES } from '@lfx-one/shared/constants';
import { BrandKitRevision, MktgDependencyDocument, MktgPrintKitRead, MktgRevisionFormat } from '@lfx-one/shared/interfaces';
import { readBrandKitRevision, readFoundationMessageContent, renderFoundationMessageMarkdown } from '@lfx-one/shared/utils';
import { catchError, defer, forkJoin, map, Observable, of, retry, Subject, throwError } from 'rxjs';
import { MktgArtifactService } from './mktg-artifact.service';

/**
 * Dependencies come only from the server's approved-current read contract.
 * Browser run history may display drafts, but never supplies downstream attachments.
 * The server alone owns the permitted pre-revision legacy fallback.
 */
@Injectable({ providedIn: 'root' })
export class MktgDependencyService {
  private readonly artifactService = inject(MktgArtifactService);
  private readonly documentsChanged = new Subject<string>();
  public readonly documentsChanged$: Observable<string> = this.documentsChanged.asObservable();

  /** Hot/replay-free invalidation after generation, approval or a pointer move. */
  public notifyDocumentsChanged(projectUid: string): void {
    if (projectUid) this.documentsChanged.next(projectUid);
  }

  /** Any missing approved selection is null; auth/network/read failures remain failures. */
  public resolveDependency(projectUid: string, agentId: string, withSidecar = false): Observable<MktgDependencyDocument | null> {
    const endpoint = MKTG_AGENT_INTAKES[agentId]?.endpoints.stored;
    if (!projectUid || !endpoint) return of(null);
    const stored$ = withSidecar ? this.artifactService.getStored(endpoint, projectUid, true) : this.artifactService.getStored(endpoint, projectUid);
    return stored$.pipe(
      map((stored): MktgDependencyDocument => {
        const document = this.markdownOf(stored.documentMarkdown, stored.format);
        if (document === null && !withSidecar) throw new Error('The approved document has no supported attachment reading.');
        return {
          agentId,
          source: 'server',
          version: stored.revisionNumber ?? stored.receipt.version,
          document: document ?? '',
          ...(stored.storedAt && { storedAt: stored.storedAt }),
          ...(stored.sidecar && { sidecar: stored.sidecar }),
        };
      }),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === HttpStatusCode.NotFound) return of(null);
        console.error('[mktg-dependency] approved current read failed', { agentId, projectUid, error });
        return throwError(() => error);
      })
    );
  }

  /** Approved branding only. Unavailable branding uses the owner's LF print/export look. */
  public resolveBrandKit(projectUid: string): Observable<BrandKitRevision | null> {
    if (!projectUid) return of(null);
    return this.resolveDependency(projectUid, BRAND_KIT_INTAKE.agentId, true).pipe(
      map((document) => readBrandKitRevision(document?.sidecar ?? null)),
      catchError(() => of(null))
    );
  }

  /**
   * The project's approved Brand Kit for a print, kept apart from a failed
   * read: the kit, or `null` when the project has none stored (a 404, or a
   * kit stored as Markdown alone, the LF look), and `failed` when the read
   * errored (auth, network, the server) after one retry — a print never sets
   * a failed read in the LF look (the Download PDF button waits and says why).
   * No project: settled with nothing, the LF look. The read is deferred so
   * the retry issues a fresh request, not a resubscription to the first.
   */
  public readBrandKit(projectUid: string): Observable<MktgPrintKitRead> {
    if (!projectUid) return of({ settled: true, kit: null, failed: false });
    return defer(() => this.resolveDependency(projectUid, BRAND_KIT_INTAKE.agentId, true)).pipe(
      retry(1),
      map((document): MktgPrintKitRead => ({ settled: true, kit: readBrandKitRevision(document?.sidecar ?? null), failed: false })),
      catchError((error: unknown) => {
        console.error('[mktg-dependency] brand kit read failed; the print waits rather than printing the LF look', { projectUid, error });
        return of({ settled: true, kit: null, failed: true });
      })
    );
  }

  /** Attachments stay strict; marketplace gating may keep successful reads when a sibling fails. */
  public resolveDependencies(
    projectUid: string,
    agentIds: string[],
    sidecarIds: string[] = [],
    allowPartial = false
  ): Observable<Record<string, MktgDependencyDocument | null>> {
    const ids = [...new Set(agentIds)];
    if (!ids.length) return of({});
    const sidecars = new Set(sidecarIds);
    return forkJoin(
      Object.fromEntries(
        ids.map((id) => [
          id,
          this.resolveDependency(projectUid, id, sidecars.has(id)).pipe(catchError((error: unknown) => (allowPartial ? of(null) : throwError(() => error)))),
        ])
      ) as Record<string, Observable<MktgDependencyDocument | null>>
    );
  }

  /** Machine attachments remain in the consumer's contract, not raw JSON shown on screen. */
  private markdownOf(text: string, format: MktgRevisionFormat | undefined): string | null {
    if (format !== 'json') return text;
    const content = readFoundationMessageContent(text);
    return content ? renderFoundationMessageMarkdown(content) : null;
  }
}
