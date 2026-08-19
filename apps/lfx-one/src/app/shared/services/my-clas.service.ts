// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ClaGroupSearchResponse, ClaSignHandoff, MyClasResponse, PdfUrlResponse } from '@lfx-one/shared/interfaces';
import { buildConsoleHandoffUrl } from '@lfx-one/shared/utils';
import { map, Observable, take } from 'rxjs';

import { environment } from '@environments/environment';

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

  /**
   * CLA Groups matching the picker's query, searched server-side across project names, CLA group
   * names, linked organizations, and pasted repository URLs (#1250).
   *
   * Returns the producer's envelope rather than a bare list: whether the result set was capped
   * is a property of the set, so it has nowhere to live inside an array. Callers still only need
   * `claGroupId` off the option they pick.
   */
  public getClaGroupOptions(query = ''): Observable<ClaGroupSearchResponse> {
    const params = query ? `?q=${encodeURIComponent(query)}` : '';
    return this.http.get<ClaGroupSearchResponse>(`/api/me/clas/sign-options${params}`);
  }

  /**
   * Resolves the Contributor Console URL for signing the given CLA Group.
   *
   * The URL is composed across the boundary: the server supplies the contributor's EasyCLA
   * identifier and the absolute return address (neither may be client-influenced), and this
   * layer adds the Console base, which lives in the Angular environment the server never
   * imports. Composing it here is what keeps the Console base from becoming a fourth
   * server-side environment variable.
   */
  public getSignUrl(claGroupId: string): Observable<string> {
    return this.http
      .get<ClaSignHandoff>('/api/me/clas/sign-handoff')
      .pipe(map((handoff) => buildConsoleHandoffUrl(environment.urls.contributorConsole, claGroupId, handoff.claUserId, handoff.redirectUrl)));
  }
}
