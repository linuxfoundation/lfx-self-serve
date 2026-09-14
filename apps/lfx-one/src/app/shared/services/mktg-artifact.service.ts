// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MktgArtifactStoredResponse } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

/**
 * Client for the SHARED Marketing OS agent-artifact read path: one project's
 * LATEST server-persisted document for ANY agent that persists one.
 *
 * The endpoint is not hard-coded here — it arrives as the agent's registered
 * `MktgAgentIntake.endpoints.stored`, which is what keeps dependency
 * resolution generic. Before this existed, resolving a dependency meant
 * injecting that agent's own client by name, so only the Brand Kit could ever
 * be resolved from the server.
 */
@Injectable({ providedIn: 'root' })
export class MktgArtifactService {
  private readonly http = inject(HttpClient);

  /**
   * The project's latest server-persisted document from an agent's `stored`
   * endpoint. The BFF gates the read on the caller's project writer
   * entitlement and 404s when nothing is stored — callers treat ANY error as
   * "no server-persisted document" and fall back to the browser-stored run.
   */
  public getStored(storedEndpoint: string, projectUid: string): Observable<MktgArtifactStoredResponse> {
    const params = new HttpParams().set('project', projectUid);
    return this.http.get<MktgArtifactStoredResponse>(storedEndpoint, { params });
  }
}
