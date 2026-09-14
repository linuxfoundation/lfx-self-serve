// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { BrandKitGenerateRequest, BrandKitGenerateResponse, BrandKitResultRequest, BrandKitResultResponse } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

/**
 * Client for the Brand Kit generation endpoints used by the standalone
 * one-page intake form. On `ready` the BFF persists the validated document
 * to object storage (dec-brand-kit-storage-v2) and reports the receipt on
 * the result response. The form-first run shell drives the same endpoints
 * generically through `MktgAgentRunService` instead.
 *
 * Reading the project's STORED Brand Kit does not live here: that read is the
 * shared agent-artifact one, and it is driven by the agent's registered
 * `endpoints.stored` through `MktgArtifactService` so every agent's document
 * resolves the same way.
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

  /**
   * Poll the generation session for the validated document.
   *
   * `projectUid` scopes the server-side persistence write that rides a ready
   * result: the BFF resolves the project, requires the caller's writer grant,
   * and partitions storage by the resolved project. Without an active project
   * the document still comes back — it simply isn't persisted (no receipt).
   */
  public getResult(sessionId: string, ownerToken: string, projectUid?: string): Observable<BrandKitResultResponse> {
    const body: BrandKitResultRequest = { sessionId, ownerToken, ...(projectUid && { project: projectUid }) };
    return this.http.post<BrandKitResultResponse>('/api/mktg-agents/brand-kit/result', body);
  }
}
