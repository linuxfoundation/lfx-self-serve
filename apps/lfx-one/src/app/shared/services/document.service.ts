// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MyDocumentItem } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

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
}
