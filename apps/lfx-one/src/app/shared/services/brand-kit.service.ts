// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { BrandKitGenerateRequest, BrandKitGenerateResponse, BrandKitResultRequest, BrandKitResultResponse } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

/**
 * Client for the Brand Kit generation endpoints (agent invocation without
 * persistence — the document is displayed and downloadable only).
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
}
