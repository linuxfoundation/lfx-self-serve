// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { LINKEDIN_API, MKTG_DOCUMENTS_API_PATH } from '@lfx-one/shared/constants';
import {
  LinkedinShareLinkResponse,
  MktgDocumentDetailResponse,
  MktgDocumentsResponse,
  MktgRestoreRevisionRequest,
  MktgRestoreRevisionResponse,
  MktgRevisionResponse,
} from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of, take, throwError } from 'rxjs';

/**
 * Client for the Marketing OS Documents area: every stored agent output of a
 * project as a document with revisions, and Restore. The BFF gates every call
 * on the caller's project writer grant.
 *
 * The GETs log and rethrow instead of returning a default: an empty list
 * would read as a real "No Brand Kit yet", so the component must be able to
 * show a failure state instead (frontend-checklist §13, the measured-fact
 * case). Restore is a one-shot POST.
 */
@Injectable({ providedIn: 'root' })
export class MktgDocumentStoreService {
  private readonly http = inject(HttpClient);

  /** Every document of the project, grouped by type in the Documents area's order. */
  public listDocuments(projectUid: string): Observable<MktgDocumentsResponse> {
    return this.http
      .get<MktgDocumentsResponse>(MKTG_DOCUMENTS_API_PATH, { params: this.projectParams(projectUid) })
      .pipe(catchError((error) => this.logAndRethrow('Failed to load Marketing OS documents', error)));
  }

  /** One document and its revisions, newest first. */
  public getDocument(projectUid: string, agentKey: string, documentId: string): Observable<MktgDocumentDetailResponse> {
    return this.http
      .get<MktgDocumentDetailResponse>(this.documentPath(agentKey, documentId), { params: this.projectParams(projectUid) })
      .pipe(catchError((error) => this.logAndRethrow('Failed to load a Marketing OS document', error)));
  }

  /** One revision of a document, with its Markdown. */
  public getRevision(projectUid: string, agentKey: string, documentId: string, revisionId: string): Observable<MktgRevisionResponse> {
    return this.http
      .get<MktgRevisionResponse>(`${this.documentPath(agentKey, documentId)}/revisions/${encodeURIComponent(revisionId)}`, {
        params: this.projectParams(projectUid),
      })
      .pipe(catchError((error) => this.logAndRethrow('Failed to load a Marketing OS document revision', error)));
  }

  /** Resolve approved bytes separately from the viewed draft; refuse a stale pointer response. */
  public getApprovedRevision(detail: MktgDocumentDetailResponse, viewed?: MktgRevisionResponse): Observable<MktgRevisionResponse | null> {
    const current = detail.approvedCurrent;
    if (detail.type.kind !== 'living' || !current) return of(null);
    const revision$ =
      viewed?.revision.id === current.revisionId ? of(viewed) : this.getRevision(detail.project, detail.type.agentKey, detail.documentId, current.revisionId);
    return revision$.pipe(
      map((revision) => {
        if (
          revision.project !== detail.project ||
          revision.type.agentKey !== detail.type.agentKey ||
          revision.documentId !== detail.documentId ||
          revision.revision.id !== current.revisionId ||
          !revision.revision.approval ||
          revision.approvedCurrent?.revisionId !== current.revisionId
        ) {
          throw new Error('The approved current changed. Reload and try again.');
        }
        return revision;
      })
    );
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

  private logAndRethrow(message: string, error: unknown): Observable<never> {
    console.error(message, error);
    return throwError(() => error);
  }

  private documentPath(agentKey: string, documentId: string): string {
    return `${MKTG_DOCUMENTS_API_PATH}/${encodeURIComponent(agentKey)}/${encodeURIComponent(documentId)}`;
  }

  private projectParams(projectUid: string): HttpParams {
    return new HttpParams().set('project', projectUid);
  }
}
