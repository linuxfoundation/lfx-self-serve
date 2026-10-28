// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MEMBER_360_API, MEMBER_360_TRACKER_FILENAME_HEADER } from '@lfx-one/shared/constants';
import { Member360GenerateRequest, Member360Session, Member360TrackerReceipt } from '@lfx-one/shared/interfaces';
import { catchError, Observable, take, throwError } from 'rxjs';

/** Dedicated intake/workbook transport. The shared Documents reader owns durable run progress. */
@Injectable({ providedIn: 'root' })
export class Member360Service {
  private readonly http = inject(HttpClient);

  public generate(body: Member360GenerateRequest): Observable<Member360Session> {
    return this.http.post<Member360Session>(`${MEMBER_360_API}/generate`, body).pipe(take(1));
  }

  public download(project: string, documentId: string): Observable<Blob> {
    return this.http.get(`${MEMBER_360_API}/documents/${encodeURIComponent(documentId)}/workbook`, { params: { project }, responseType: 'blob' }).pipe(
      catchError((error) => {
        console.error('Member 360 workbook download failed', error);
        return throwError(() => error);
      })
    );
  }

  public parseTracker(project: string, file: File): Observable<Member360TrackerReceipt> {
    return this.http
      .post<Member360TrackerReceipt>(`${MEMBER_360_API}/tracker`, file, {
        params: { project },
        headers: { 'Content-Type': 'application/octet-stream', [MEMBER_360_TRACKER_FILENAME_HEADER]: encodeURIComponent(file.name) },
      })
      .pipe(take(1));
  }
}
