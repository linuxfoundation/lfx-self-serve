// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MKTG_DOCUMENTS_API_PATH } from '@lfx-one/shared/constants';
import {
  MktgDocumentDetailResponse,
  MktgDocumentsResponse,
  MktgRestoreRevisionRequest,
  MktgRestoreRevisionResponse,
  MktgRevisionResponse,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, take, throwError } from 'rxjs';

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

  /** Make an older revision the latest, as a new revision. */
  public restoreRevision(projectUid: string, agentKey: string, documentId: string, revisionId: string): Observable<MktgRestoreRevisionResponse> {
    const body: MktgRestoreRevisionRequest = { project: projectUid, revisionId };
    return this.http.post<MktgRestoreRevisionResponse>(`${this.documentPath(agentKey, documentId)}/restore`, body).pipe(take(1));
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
