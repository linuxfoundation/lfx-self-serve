// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ClaGroupOption, GithubAccountOptions, MyClasResponse, PdfUrlResponse, SigningIdentityRequest, SigningIdentityResponse } from '@lfx-one/shared/interfaces';
import { buildConsoleHandoffUrl } from '@lfx-one/shared/utils';
import { Observable, take } from 'rxjs';

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
   * CLA Groups matching the picker's query; an empty query lists everything.
   *
   * Currently served by a stub that substring-matches; #1250 replaces the route's implementation
   * with the real four-source search. This call site is written to survive that swap unchanged,
   * which is why the query goes to the server rather than being filtered in the browser.
   */
  public getClaGroupOptions(query = ''): Observable<ClaGroupOption[]> {
    const params = query ? `?q=${encodeURIComponent(query)}` : '';
    return this.http.get<ClaGroupOption[]>(`/api/me/clas/sign-options${params}`);
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
   * Records the contributor's chosen GitHub account, returning the EasyCLA record identifier
   * the hand-off uses.
   *
   * Only the account number is sent. The server matches it against the accounts linked to this
   * session and reads the handle from the match, so an account that did not come from
   * `getGithubAccounts` above is refused there rather than recorded.
   */
  public bindSigningIdentity(githubId: string): Observable<SigningIdentityResponse> {
    const body: SigningIdentityRequest = { githubId };
    return this.http.post<SigningIdentityResponse>('/api/me/clas/signing-identity', body).pipe(take(1));
  }

  /**
   * Resolves the Console URL from an association the binding has already confirmed.
   *
   * Takes both server-supplied halves from the binding response rather than re-fetching
   * them, which is what makes it impossible to hand off with an identifier the binding did
   * not settle on — including the case the older path could not serve at all, a first-time
   * signer with no record to find yet.
   */
  public buildSignUrlFor(claGroupId: string, identity: SigningIdentityResponse): string {
    return buildConsoleHandoffUrl(environment.urls.contributorConsole, claGroupId, identity.claUserId, identity.redirectUrl);
  }
}
