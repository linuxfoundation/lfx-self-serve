// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { MKTG_RUN_POLL, MKTG_RUN_STORAGE_KEY_PREFIX } from '@lfx-one/shared/constants';
import {
  MktgChatRequest,
  MktgChatResponse,
  MktgGenerateProgress,
  MktgGenerateRequest,
  MktgHistoryResponse,
  MktgRunVersion,
  MktgSessionInfo,
  MktgStoredAgentRun,
} from '@lfx-one/shared/interfaces';
import { renderMktgIntakeMessage } from '@lfx-one/shared/utils';
import { concat, filter, map, Observable, of, switchMap, take, timeout, timer } from 'rxjs';

/**
 * Form-first agent runs for the Marketing OS marketplace. Submits batch intake
 * forms through the existing chat/session BFF (`/api/mktg-agents/chat` +
 * `/history`), polls the session for the generated document, and persists each
 * run (session + answers + versions) in localStorage so the marketplace can
 * badge agents with stored output and the run page can restore prior results.
 */
@Injectable({ providedIn: 'root' })
export class MktgAgentRunService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * Generates (or regenerates) an agent document. Emits `submitted` once the
   * chat POST resolves, then `document` with the updated stored run once the
   * agent's reply lands. Regeneration resubmits the full form plus feedback and
   * prior_version as a follow-up on the run's existing Guild session.
   */
  public generate(request: MktgGenerateRequest): Observable<MktgGenerateProgress> {
    const message = renderMktgIntakeMessage(request.intake, request.answers, request.feedback, request.priorVersion);
    const stored = this.loadRun(request.projectUid, request.agentId);

    // On a follow-up the session already holds history — snapshot the known
    // message ids first so only messages produced by this submission count.
    const baseline$: Observable<Set<string>> = stored
      ? this.history(stored.sessionId).pipe(map((response) => new Set(response.messages.map((historyMessage) => historyMessage.id))))
      : of(new Set<string>());

    return baseline$.pipe(
      switchMap((knownIds) =>
        this.chat({ agentId: request.agentId, message, sessionId: stored?.sessionId ?? null, ownerToken: stored?.ownerToken }).pipe(
          map((response) => ({
            knownIds,
            session:
              'sessionId' in response
                ? { agentId: request.agentId, sessionId: response.sessionId, ownerToken: response.ownerToken }
                : // Follow-up acks carry no ids — the stored session is unchanged.
                  { agentId: request.agentId, sessionId: stored!.sessionId, ownerToken: stored!.ownerToken },
          }))
        )
      ),
      switchMap(({ knownIds, session }) =>
        concat(
          of<MktgGenerateProgress>({ type: 'submitted' }),
          this.pollForDocument(session.sessionId, knownIds).pipe(
            map((document) => ({ type: 'document' as const, run: this.appendVersion(request, session, document) }))
          )
        )
      )
    );
  }

  /** Reads the stored run for a project + agent. Returns null on the server or when nothing is stored. */
  public loadRun(projectUid: string, agentId: string): MktgStoredAgentRun | null {
    if (!isPlatformBrowser(this.platformId) || !projectUid) {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(this.storageKey(projectUid, agentId));
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as MktgStoredAgentRun;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.versions) || !parsed.sessionId || !parsed.ownerToken) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private chat(request: MktgChatRequest): Observable<MktgChatResponse> {
    return this.http.post<MktgChatResponse>('/api/mktg-agents/chat', request);
  }

  private history(sessionId: string): Observable<MktgHistoryResponse> {
    return this.http.get<MktgHistoryResponse>('/api/mktg-agents/history', { params: { sessionId } });
  }

  /**
   * Polls session history until an agent message that wasn't in the baseline
   * appears, then emits its text. Batch mode tells the agent to draft directly
   * (no clarifying round-trips), so the first fresh agent reply is the
   * document; when a poll catches several, the latest wins.
   */
  private pollForDocument(sessionId: string, knownIds: ReadonlySet<string>): Observable<string> {
    return timer(MKTG_RUN_POLL.initialDelayMs, MKTG_RUN_POLL.intervalMs).pipe(
      switchMap(() => this.history(sessionId)),
      map((response) => {
        const fresh = response.messages.filter((historyMessage) => historyMessage.sender === 'agent' && !knownIds.has(historyMessage.id));
        return fresh.length > 0 ? fresh[fresh.length - 1].text : null;
      }),
      filter((document): document is string => document !== null),
      take(1),
      timeout(MKTG_RUN_POLL.timeoutMs)
    );
  }

  /** Appends the generated document as the next version and persists the run. */
  private appendVersion(request: MktgGenerateRequest, session: MktgSessionInfo, document: string): MktgStoredAgentRun {
    const stored = this.loadRun(request.projectUid, request.agentId);
    const lastVersion = stored?.versions.length ? stored.versions[stored.versions.length - 1].version : 0;
    const version: MktgRunVersion = {
      version: lastVersion + 1,
      document,
      feedback: request.feedback,
      createdAt: new Date().toISOString(),
    };
    const run: MktgStoredAgentRun = {
      agentId: request.agentId,
      projectUid: request.projectUid,
      sessionId: session.sessionId,
      ownerToken: session.ownerToken,
      answers: { ...request.answers },
      versions: [...(stored?.versions ?? []), version],
    };
    this.saveRun(run);
    return run;
  }

  /** Best-effort persistence — quota/disabled-storage failures never fail the run. */
  private saveRun(run: MktgStoredAgentRun): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      window.localStorage.setItem(this.storageKey(run.projectUid, run.agentId), JSON.stringify(run));
    } catch {
      // Ignore — the in-memory result still renders; only cross-visit restore is lost.
    }
  }

  private storageKey(projectUid: string, agentId: string): string {
    return `${MKTG_RUN_STORAGE_KEY_PREFIX}:${projectUid}:${agentId}`;
  }
}
