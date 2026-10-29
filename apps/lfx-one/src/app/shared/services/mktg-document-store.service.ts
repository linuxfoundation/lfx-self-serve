// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { LINKEDIN_API, MKTG_DOCUMENTS_API_PATH } from '@lfx-one/shared/constants';
import {
  LinkedinShareLinkResponse,
  MktgDocumentDetailResponse,
  MktgDocumentsResponse,
  MktgRestoreRevisionRequest,
  MktgRestoreRevisionResponse,
  MktgRevisionResponse,
  MktgRetryDocumentRunRequest,
} from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of, switchMap, take, throwError } from 'rxjs';

/**
 * Client for the Marketing OS Documents area: every stored agent output of a
 * project as a document with revisions, and Restore. The BFF gates every call
 * on the caller's project writer grant.
 *
 * The GETs log and rethrow unexpected failures instead of returning a default: an empty list
 * would read as a real "No Brand Kit yet", so the component must be able to
 * show a failure state instead (frontend-checklist §13, the measured-fact
 * case). An explicitly identified pending document may rethrow its expected
 * pre-storage 404 without logging it. Restore is a one-shot POST.
 */
@Injectable({ providedIn: 'root' })
export class MktgDocumentStoreService {
  private readonly http = inject(HttpClient);

  /** Every document of the project, grouped by type in the Documents area's order. */
  public listDocuments(projectUid: string, poll = false, ownRuns = false): Observable<MktgDocumentsResponse> {
    let params = this.projectParams(projectUid, poll);
    if (ownRuns) params = params.set('ownRuns', '1');
    return this.http
      .get<MktgDocumentsResponse>(MKTG_DOCUMENTS_API_PATH, { params })
      .pipe(catchError((error) => this.logAndRethrow('Failed to load Marketing OS documents', error)));
  }

  /** Document/revisions/progress; refreshRunId refreshes only an explicit navigation, not a timer. A matching pending audit may expect a pre-storage 404. */
  public getDocument(
    projectUid: string,
    agentKey: string,
    documentId: string,
    poll = false,
    refreshRunId?: string,
    expectedPending = false,
    selectedRunId?: string
  ): Observable<MktgDocumentDetailResponse> {
    let params = this.projectParams(projectUid, poll);
    if (refreshRunId) params = params.set('refreshRun', refreshRunId);
    if (selectedRunId) params = params.set('run', selectedRunId);
    return this.http.get<MktgDocumentDetailResponse>(this.documentPath(agentKey, documentId), { params }).pipe(
      catchError((error: unknown) => {
        if (expectedPending && error instanceof HttpErrorResponse && error.status === 404) {
          return throwError(() => error);
        }
        return this.logAndRethrow('Failed to load a Marketing OS document', error);
      })
    );
  }

  /** One revision and its stored body, with public run progress. */
  public getRevision(projectUid: string, agentKey: string, documentId: string, revisionId: string, poll = false): Observable<MktgRevisionResponse> {
    return this.http
      .get<MktgRevisionResponse>(`${this.documentPath(agentKey, documentId)}/revisions/${encodeURIComponent(revisionId)}`, {
        params: this.projectParams(projectUid, poll),
      })
      .pipe(catchError((error) => this.logAndRethrow('Failed to load a Marketing OS document revision', error)));
  }

  /** Resolve approved bytes separately from the viewed draft; refuse a stale pointer response. */
  public getApprovedRevision(detail: MktgDocumentDetailResponse, viewed?: MktgRevisionResponse): Observable<MktgRevisionResponse | null> {
    return this.readApprovedRevision(detail, viewed, true);
  }

  /** Approve an existing revision; the response includes the approved current selection. */
  public approveRevision(projectUid: string, agentKey: string, documentId: string, revisionId: string): Observable<MktgRevisionResponse> {
    return this.http
      .post<MktgRevisionResponse>(
        `${this.documentPath(agentKey, documentId)}/revisions/${encodeURIComponent(revisionId)}/approve`,
        {},
        { params: this.projectParams(projectUid) }
      )
      .pipe(take(1));
  }

  /** Make a revision current without adding history; `/restore` is the compatibility URL. */
  public restoreRevision(projectUid: string, agentKey: string, documentId: string, revisionId: string): Observable<MktgRestoreRevisionResponse> {
    const body: MktgRestoreRevisionRequest = { project: projectUid, revisionId };
    return this.http.post<MktgRestoreRevisionResponse>(`${this.documentPath(agentKey, documentId)}/restore`, body).pipe(take(1));
  }

  public saveLinkedinShareLink(project: string, documentId: string, shareLink: string): Observable<LinkedinShareLinkResponse> {
    return this.http
      .patch<LinkedinShareLinkResponse>(`${LINKEDIN_API}/documents/${encodeURIComponent(documentId)}/share-link`, { project, share_link: shareLink })
      .pipe(take(1));
  }

  /** Check the recorded session again; never submit another Generate POST. */
  public retryRun(projectUid: string, agentKey: string, documentId: string, runId: string): Observable<MktgDocumentDetailResponse> {
    const body: MktgRetryDocumentRunRequest = { project: projectUid };
    return this.http.post<MktgDocumentDetailResponse>(`${this.documentPath(agentKey, documentId)}/runs/${encodeURIComponent(runId)}/retry`, body).pipe(take(1));
  }

  private readApprovedRevision(
    detail: MktgDocumentDetailResponse,
    viewed: MktgRevisionResponse | undefined,
    retry: boolean
  ): Observable<MktgRevisionResponse | null> {
    const current = detail.approvedCurrent;
    if (detail.type.kind !== 'living' || !current) return of(null);
    const revision$ =
      viewed?.revision.id === current.revisionId ? of(viewed) : this.getRevision(detail.project, detail.type.agentKey, detail.documentId, current.revisionId);
    return revision$.pipe(
      map((revision) => {
        if (revision.project !== detail.project || revision.type.agentKey !== detail.type.agentKey || revision.documentId !== detail.documentId) {
          throw new Error('The approved current changed. Reload and try again.');
        }
        if (revision.revision.id !== current.revisionId || !revision.revision.approval || revision.approvedCurrent?.revisionId !== current.revisionId) {
          throw new HttpErrorResponse({
            status: 409,
            error: {
              code: 'MKTG_APPROVED_CURRENT_CHANGED',
              message: 'The approved current changed. Reload and try again.',
            },
          });
        }
        return revision;
      }),
      catchError((error: unknown) => {
        if (!retry || !(error instanceof HttpErrorResponse) || error.error?.code !== 'MKTG_APPROVED_CURRENT_CHANGED') return throwError(() => error);
        return this.getDocument(detail.project, detail.type.agentKey, detail.documentId).pipe(
          switchMap((fresh) => this.readApprovedRevision(fresh, undefined, false))
        );
      })
    );
  }

  private logAndRethrow(message: string, error: unknown): Observable<never> {
    if (error instanceof HttpErrorResponse) console.error(message, { status: error.status });
    else if (error instanceof Error) console.error(message, { errorType: error.name });
    else console.error(message, { errorType: typeof error });
    return throwError(() => error);
  }

  private documentPath(agentKey: string, documentId: string): string {
    return `${MKTG_DOCUMENTS_API_PATH}/${encodeURIComponent(agentKey)}/${encodeURIComponent(documentId)}`;
  }

  private projectParams(projectUid: string, poll = false): HttpParams {
    const params = new HttpParams().set('project', projectUid);
    return poll ? params.set('poll', '1') : params;
  }
}
