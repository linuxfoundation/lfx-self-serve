// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MyClasResponse, PdfUrlResponse } from '@lfx-one/shared/interfaces';
import { Observable, take } from 'rxjs';

/** Client for the read-only "CLAs" server endpoints (Me lens → Profile tab). */
@Injectable({
  providedIn: 'root',
})
export class MyClasService {
  private readonly http = inject(HttpClient);

  /** Fetches the current user's signed ICLAs/ECLAs and identity-resolution summary. */
  public getMyClas(): Observable<MyClasResponse> {
    return this.http.get<MyClasResponse>('/api/me/clas').pipe(take(1));
  }

  /** Resolves a short-lived presigned URL for an owned ICLA's signed PDF. */
  public getPdfUrl(signatureId: string): Observable<PdfUrlResponse> {
    return this.http.get<PdfUrlResponse>(`/api/me/clas/${encodeURIComponent(signatureId)}/pdf-url`).pipe(take(1));
  }
}
