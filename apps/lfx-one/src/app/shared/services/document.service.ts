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

  public getMyDocuments(projectUid?: string | null): Observable<MyDocumentItem[]> {
    const params = projectUid ? new HttpParams().set('project_uid', projectUid) : undefined;
    return this.http.get<MyDocumentItem[]>('/api/documents', { params });
  }
}
