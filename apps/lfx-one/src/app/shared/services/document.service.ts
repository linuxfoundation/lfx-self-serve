// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MyDocumentItem } from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class DocumentService {
  private readonly http = inject(HttpClient);

  /**
   * Fetches documents for the current user, optionally scoped to a project and/or committee.
   * @param projectUid - Filter to documents belonging to this project (foundation)
   * @param committeeUid - Further scope to a specific committee within the project
   */
  public getMyDocuments(projectUid?: string | null, committeeUid?: string | null): Observable<MyDocumentItem[]> {
    let params = new HttpParams();
    if (projectUid) params = params.set('project_uid', projectUid);
    if (committeeUid) params = params.set('committee_uid', committeeUid);
    return this.http.get<MyDocumentItem[]>('/api/documents', { params: params.keys().length ? params : undefined });
  }

  /** Counts the documents a group's Documents tab lists, without fetching them. Resolves to null on error so a badge can stay hidden. */
  public getCommitteeDocumentCount(committeeUid: string): Observable<number | null> {
    const params = new HttpParams().set('committee_uid', committeeUid);
    return this.http.get<{ count: number }>('/api/documents/count', { params }).pipe(
      map(({ count }) => count),
      catchError(() => of(null))
    );
  }
}
