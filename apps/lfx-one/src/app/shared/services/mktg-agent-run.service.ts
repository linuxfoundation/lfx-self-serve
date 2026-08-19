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
  MktgRunGenerateBody,
  MktgRunResultBody,
  MktgRunResultResponse,
  MktgRunSessionResponse,
  MktgRunVersion,
  MktgSessionInfo,
  MktgStoredAgentRun,
} from '@lfx-one/shared/interfaces';
import { renderMktgIntakeMessage } from '@lfx-one/shared/utils';
import { concat, filter, map, Observable, of, switchMap, take, timeout, timer } from 'rxjs';

/**
 * Form-first agent runs for the Marketing OS marketplace. A first run submits
 * the batch intake answers to the agent's validated generate endpoint (the BFF
 * renders the batch message server-side); every follow-up — edit-inputs
 * resubmit or feedback regeneration — resubmits the full form plus the stored
 * run's prior version (and feedback, when given) on the run's existing Guild
 * session via the chat/session BFF. Either way the document comes exclusively
 * from the agent's result endpoint, which returns only schema-validated,
 * sha256-verified envelopes — raw chat text is never treated as the document.
 * Each run (session + answers + versions) persists in localStorage so the
 * marketplace can badge agents with stored output and the run page can restore
 * prior results.
 */
@Injectable({ providedIn: 'root' })
export class MktgAgentRunService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * Generates (or regenerates) an agent document. Emits `submitted` once the
   * generate/chat POST resolves, then `document` with the updated stored run
   * once the validated document lands.
   */
  public generate(request: MktgGenerateRequest): Observable<MktgGenerateProgress> {
    const stored = this.loadRun(request.projectUid, request.agentId);
    // The stored run's latest version is the single source of truth for BOTH
    // the follow-up message's "finalize as version N+1" directive and the poll
    // gate below — deriving them together means the agent is always told to
    // produce the exact version the poll will accept. (The result endpoint
    // reports the best envelope in the WHOLE session, so on a follow-up the
    // prior draft is already `ready` — only a strictly newer version counts as
    // this submission's document.)
    const priorVersion = stored?.versions.at(-1)?.version;
    const session$: Observable<MktgSessionInfo> = stored ? this.followUp(request, stored, priorVersion) : this.startRun(request);

    return session$.pipe(
      switchMap((session) =>
        concat(
          of<MktgGenerateProgress>({ type: 'submitted' }),
          this.pollForDocument(request.intake.endpoints.result, session, priorVersion ?? 0).pipe(
            map((result) => ({ type: 'document' as const, run: this.appendVersion(request, session, result) }))
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

  /**
   * First run: one-shot form-mode generation through the agent's validated
   * generate endpoint. The BFF validates the answers against the agent's own
   * intake schema and renders the batch message server-side.
   */
  private startRun(request: MktgGenerateRequest): Observable<MktgSessionInfo> {
    const body: MktgRunGenerateBody = { answers: request.answers };
    return this.http
      .post<MktgRunSessionResponse>(request.intake.endpoints.generate, body)
      .pipe(map((response) => ({ agentId: request.agentId, sessionId: response.sessionId, ownerToken: response.ownerToken })));
  }

  /**
   * Follow-up on the run's existing Guild session (edit-inputs resubmit or
   * "Request changes" regeneration): the full form — always with the
   * prior-version directive so the agent finalizes as v+1, plus the feedback
   * paragraph when regenerating — rendered as the agent's batch message and
   * posted through the chat/session BFF contract.
   */
  private followUp(request: MktgGenerateRequest, stored: MktgStoredAgentRun, priorVersion: number | undefined): Observable<MktgSessionInfo> {
    const body: MktgChatRequest = {
      agentId: request.agentId,
      message: renderMktgIntakeMessage(request.intake, request.answers, request.feedback, priorVersion),
      sessionId: stored.sessionId,
      ownerToken: stored.ownerToken,
    };
    return this.http
      .post<MktgChatResponse>('/api/mktg-agents/chat', body)
      .pipe(map(() => ({ agentId: request.agentId, sessionId: stored.sessionId, ownerToken: stored.ownerToken })));
  }

  /**
   * Polls the agent's validated result endpoint (owner token in the POST body,
   * never the query string) until it reports a `ready` document with a version
   * newer than the prior draft's. The endpoint surfaces only schema-validated,
   * sha256-verified envelopes, so agent status chatter can never be mistaken
   * for the document — anything else stays `pending`.
   */
  private pollForDocument(resultPath: string, session: MktgSessionInfo, priorVersion: number): Observable<MktgRunResultResponse> {
    const body: MktgRunResultBody = { sessionId: session.sessionId, ownerToken: session.ownerToken };
    return timer(MKTG_RUN_POLL.initialDelayMs, MKTG_RUN_POLL.intervalMs).pipe(
      switchMap(() => this.http.post<MktgRunResultResponse>(resultPath, body)),
      filter((result) => result.status === 'ready' && typeof result.documentMarkdown === 'string' && (result.version ?? 0) > priorVersion),
      take(1),
      timeout(MKTG_RUN_POLL.timeoutMs)
    );
  }

  /** Appends the validated document as the next version and persists the run. */
  private appendVersion(request: MktgGenerateRequest, session: MktgSessionInfo, result: MktgRunResultResponse): MktgStoredAgentRun {
    const stored = this.loadRun(request.projectUid, request.agentId);
    const lastVersion = stored?.versions.length ? stored.versions[stored.versions.length - 1].version : 0;
    const version: MktgRunVersion = {
      // The envelope's own version is authoritative; pollForDocument guaranteed
      // it (and the document) is present, so the fallbacks are type-narrowing only.
      version: result.version ?? lastVersion + 1,
      document: result.documentMarkdown ?? '',
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
