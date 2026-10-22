// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MKTG_FAMILY_EXPORT_API_PATH, MKTG_PRINT_FONT_WEIGHTS } from '@lfx-one/shared/constants';
import {
  MktgFamilyExportLastResponse,
  MktgFamilyExportMember,
  MktgFamilyExportRecord,
  MktgFamilyExportResultResponse,
  MktgFamilyExportRunUpdate,
  MktgFamilyExportStartResponse,
  MktgFamilyExportTarget,
  MktgFamilyPrintView,
  MktgSlidesExportMode,
} from '@lfx-one/shared/interfaces';
import { buildBrandKitBookView, buildFoundationMessagePrintView, readBrandKitRevision, readFoundationMessageContent } from '@lfx-one/shared/utils';
import { pollMktgSlidesExport } from '@shared/utils/mktg-slides-export-poll.util';
import { catchError, finalize, forkJoin, map, Observable, shareReplay, startWith, switchMap, take, throwError } from 'rxjs';
import { MktgDocumentStoreService } from './mktg-document-store.service';

/** Family-scoped lookups and runs, independent of the family's document-list loading. */
@Injectable({ providedIn: 'root' })
export class MktgFamilyExportService {
  private readonly http = inject(HttpClient);
  private readonly documents = inject(MktgDocumentStoreService);
  private readonly lookups = new Map<string, Observable<MktgFamilyExportLastResponse>>();
  private readonly runs = new Map<string, Observable<MktgFamilyExportRunUpdate>>();

  public last(target: MktgFamilyExportTarget, refresh = false): Observable<MktgFamilyExportLastResponse> {
    const key = this.key(target);
    const existing = this.lookups.get(key);
    if (existing && !refresh) return existing;
    const params = new HttpParams().set('project', target.project).set('familyId', target.familyId);
    const lookup = this.http.get<MktgFamilyExportLastResponse>(`${MKTG_FAMILY_EXPORT_API_PATH}/last`, { params }).pipe(
      take(1),
      catchError((error: unknown) => {
        console.error('[mktg-family-export] Last export read failed', error);
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.lookups.set(key, lookup);
    return lookup;
  }

  public running(target: MktgFamilyExportTarget): Observable<MktgFamilyExportRunUpdate> | null {
    return this.runs.get(this.key(target)) ?? null;
  }

  /** A run outlives its page. Returning to the family attaches instead of creating a duplicate. */
  public run(target: MktgFamilyExportTarget, mode: MktgSlidesExportMode): Observable<MktgFamilyExportRunUpdate> {
    const key = this.key(target);
    const existing = this.runs.get(key);
    if (existing) return existing;
    const initial: MktgFamilyExportRunUpdate = { mode, skippedMembers: [], logoNote: null, result: null };
    const run = this.http.post<MktgFamilyExportStartResponse>(`${MKTG_FAMILY_EXPORT_API_PATH}/start`, { ...target, mode }).pipe(
      take(1),
      switchMap((started) => {
        const update: MktgFamilyExportRunUpdate = { ...initial, skippedMembers: started.skippedMembers, logoNote: started.logoNote };
        return this.poll(started).pipe(
          map((result) => ({ ...update, result })),
          startWith(update)
        );
      }),
      startWith(initial),
      finalize(() => {
        this.runs.delete(key);
        this.lookups.delete(key);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.runs.set(key, run);
    return run;
  }

  /** Immutable started refs and owner token are replayed verbatim; a pending HTTP request is bounded too. */
  public poll(started: MktgFamilyExportStartResponse): Observable<MktgFamilyExportResultResponse> {
    const body = {
      project: started.snapshot.project,
      familyId: started.snapshot.familyId,
      sessionId: started.sessionId,
      ownerToken: started.ownerToken,
      snapshot: started.snapshot,
    };
    return pollMktgSlidesExport<MktgFamilyExportRecord>(
      () => this.http.post<MktgFamilyExportResultResponse>(`${MKTG_FAMILY_EXPORT_API_PATH}/result`, body),
      started.sessionId
    );
  }

  /** Read approved refs only. Reject changed pointers instead of printing a different revision. */
  public printView(target: MktgFamilyExportTarget, members: MktgFamilyExportMember[], projectName: string): Observable<MktgFamilyPrintView> {
    const printable = members.filter((member) => member.agentKey === 'foundation-message' || member.agentKey === 'brand-kit');
    if (!printable.length) return throwError(() => new Error('No approved members have a print layout.'));
    return forkJoin(
      printable.map((member) =>
        this.documents.getRevision(target.project, member.agentKey, member.documentId, member.revisionId).pipe(
          map((response) => {
            if (
              response.project !== target.project ||
              response.type.agentKey !== member.agentKey ||
              response.documentId !== member.documentId ||
              response.revision.id !== member.revisionId ||
              response.revision.contentSha256 !== member.contentSha256 ||
              !response.approval ||
              response.approvedCurrent?.revisionId !== member.revisionId
            )
              throw new Error('The approved current changed. Reload and try again.');
            return response;
          })
        )
      )
    ).pipe(
      map((responses) => {
        const kitResponse = responses.find((response) => response.type.agentKey === 'brand-kit');
        const kit = kitResponse ? readBrandKitRevision(kitResponse.sidecar) : null;
        if (kitResponse && !kit) throw new Error('The approved brand kit could not be read.');
        const frameworkResponse = responses.find((response) => response.type.agentKey === 'foundation-message');
        const content = frameworkResponse ? readFoundationMessageContent(frameworkResponse.markdown) : null;
        if (frameworkResponse && !content) throw new Error('The approved messaging framework could not be read.');
        const book = kit ? buildBrandKitBookView(kit, kitResponse?.revision.number) : null;
        const framework = content ? buildFoundationMessagePrintView(content, projectName, frameworkResponse?.revision.number ?? null, kit) : null;
        return {
          framework,
          kit: book,
          fontFamily: book?.fontUrl ? book.type.family : (framework?.brand.fontFamily ?? null),
          weights: book?.weights.map((weight) => weight.weight) ?? MKTG_PRINT_FONT_WEIGHTS,
        };
      })
    );
  }

  private key(target: MktgFamilyExportTarget): string {
    return JSON.stringify([target.project, target.familyId]);
  }
}
