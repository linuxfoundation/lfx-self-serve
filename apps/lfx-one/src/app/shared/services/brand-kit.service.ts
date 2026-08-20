// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  BrandKitGenerateRequest,
  BrandKitGenerateResponse,
  BrandKitResultRequest,
  BrandKitResultResponse,
  BrandKitStoredResponse,
} from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

/**
 * Client for the Brand Kit generation endpoints used by the standalone
 * one-page intake form. On `ready` the BFF persists the validated document
 * to object storage (dec-brand-kit-storage-v2) and reports the receipt on
 * the result response. The form-first run shell drives the same endpoints
 * generically through `MktgAgentRunService` instead.
 */
@Injectable({
  providedIn: 'root',
})
export class BrandKitService {
  private readonly http = inject(HttpClient);

  /** Start a one-shot form-mode generation from the 7 intake answers. */
  public generate(answers: Record<string, string>): Observable<BrandKitGenerateResponse> {
    const body: BrandKitGenerateRequest = { answers };
    return this.http.post<BrandKitGenerateResponse>('/api/mktg-agents/brand-kit/generate', body);
  }

  /** Poll the generation session for the validated document. */
  public getResult(sessionId: string, ownerToken: string): Observable<BrandKitResultResponse> {
    const body: BrandKitResultRequest = { sessionId, ownerToken };
    return this.http.post<BrandKitResultResponse>('/api/mktg-agents/brand-kit/result', body);
  }

  /**
   * The project's latest SERVER-persisted Brand Kit document with its receipt
   * metadata (dec-agent-dependency-gating read path). The BFF gates the read
   * on the caller's project writer entitlement and 404s when nothing is
   * stored — callers treat any error as "no server-persisted kit" and fall
   * back to the browser-stored run.
   */
  public getStored(projectUid: string): Observable<BrandKitStoredResponse> {
    const params = new HttpParams().set('project', projectUid);
    return this.http.get<BrandKitStoredResponse>('/api/mktg-agents/brand-kit/stored', { params });
  }
}
