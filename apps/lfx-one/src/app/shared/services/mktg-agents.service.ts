// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MktgChatMessage, MktgChatRequest, MktgChatResponse, MktgHistoryResponse } from '@lfx-one/shared/interfaces';
import { map, Observable } from 'rxjs';

// Frontend client for the Marketing OS Agents Guild proxy (LFXAI-99). Thin
// wrapper over the BFF endpoints mounted at /api/mktg-agents — the Guild
// credentials and routing live entirely server-side.
@Injectable({ providedIn: 'root' })
export class MktgAgentsService {
  private readonly http = inject(HttpClient);

  /**
   * Create a Guild session (no `sessionId`) or post a follow-up (with
   * `sessionId` + `ownerToken`). A new session resolves to
   * `{ sessionId, ownerToken }`; a follow-up resolves to `{ success: true }`.
   */
  public sendMessage(payload: MktgChatRequest): Observable<MktgChatResponse> {
    return this.http.post<MktgChatResponse>('/api/mktg-agents/chat', payload);
  }

  /**
   * Fetch a session's mapped chat history (oldest first).
   *
   * Errors are intentionally NOT swallowed with a `catchError(() => of([]))`
   * fallback: the caller distinguishes an expired/missing session (which it
   * recovers from via `handleExpiredSession`) from a transient poll hiccup
   * (which it retries). A service-level fallback would mask both and make that
   * recovery path dead code.
   */
  public getHistory(sessionId: string): Observable<MktgChatMessage[]> {
    const params = new HttpParams().set('sessionId', sessionId);
    return this.http.get<MktgHistoryResponse>('/api/mktg-agents/history', { params }).pipe(map((response) => response.messages));
  }
}
