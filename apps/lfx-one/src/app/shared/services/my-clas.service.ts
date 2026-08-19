// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  ClaGroupSearchResponse,
  GithubAccountOptions,
  MyClasResponse,
  PdfUrlResponse,
  PrepareSignRequest,
  PrepareSignResponse,
} from '@lfx-one/shared/interfaces';
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
   * The GitHub accounts the contributor has already linked (#1252).
   *
   * A failure here is a failure, never an empty list: the caller routes an empty list into
   * account-linking, and doing that to someone who does have a linked account sends them to
   * fix something that is not broken.
   */
  public getGithubAccounts(): Observable<GithubAccountOptions> {
    return this.http.get<GithubAccountOptions>('/api/me/clas/github-accounts').pipe(take(1));
  }

  /**
   * Asks the CLA backend to open a signing session for the chosen account and CLA group, and
   * returns the Contributor Console address it wants the contributor sent to.
   *
   * Only the account number and the group are sent. The server reads the handle from the
   * accounts linked to this session and derives the return address from the request, so an
   * account that did not come from `getGithubAccounts` above is refused there, and neither the
   * handle nor the return address is this app's to name.
   *
   * The address comes back rather than being assembled from the answer's parts: the CLA backend
   * owns the signing session it belongs to, so composing a second one here would ignore whatever
   * that session carries.
   */
  public prepareSign(body: PrepareSignRequest): Observable<PrepareSignResponse> {
    return this.http.post<PrepareSignResponse>('/api/me/clas/prepare-sign', body).pipe(take(1));
  }
}
