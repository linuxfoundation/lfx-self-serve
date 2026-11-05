// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IT_OS_LIVE_MAX_WAIT_MS, IT_OS_LIVE_POLL_MS } from '@lfx-one/shared/constants';
import { ItOsGuildChatResponse, ItOsGuildHistoryResponse, MktgChatMessage } from '@lfx-one/shared/interfaces';
import { Subscription, switchMap, take, timer } from 'rxjs';

/**
 * Live chat with an IT OS agent on Guild (#4257), through /api/it-os-agents. Dev only: the server
 * refuses every call elsewhere. Provided per page, so each visit starts a new conversation.
 *
 * Sending posts the message, then polls the session history until the agent has replied and the
 * history stops growing (agents can answer in more than one message), or until the wait runs out.
 */
@Injectable()
export class ItOsLiveAgentService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  public readonly messages = signal<MktgChatMessage[]>([]);
  /** True from sending a message until the agent's reply has settled. */
  public readonly waiting = signal(false);
  public readonly error = signal<string | null>(null);

  private session: { id: string; ownerToken: string } | null = null;
  private poll?: Subscription;
  private localId = 0;

  public send(agentId: string, project: string, text: string): void {
    const message = text.trim();
    if (!message || this.waiting()) return;
    this.error.set(null);
    this.waiting.set(true);
    const agentRepliesBefore = this.agentReplies(this.messages());
    this.messages.update((list) => [...list, { id: `local-${++this.localId}`, sender: 'user', text: message, timestamp: '' }]);

    const body = { agentId, project, message, ...(this.session ? { sessionId: this.session.id, ownerToken: this.session.ownerToken } : {}) };
    this.http
      .post<ItOsGuildChatResponse>('/api/it-os-agents/chat', body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.sessionId && response.ownerToken) this.session = { id: response.sessionId, ownerToken: response.ownerToken };
          this.waitForReply(agentId, project, agentRepliesBefore);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  /** Starts a new conversation. */
  public reset(): void {
    this.poll?.unsubscribe();
    this.session = null;
    this.messages.set([]);
    this.waiting.set(false);
    this.error.set(null);
  }

  private waitForReply(agentId: string, project: string, agentRepliesBefore: number): void {
    const session = this.session;
    if (!session) {
      this.fail(null);
      return;
    }
    let lastCount = -1;
    this.poll?.unsubscribe();
    this.poll = timer(IT_OS_LIVE_POLL_MS, IT_OS_LIVE_POLL_MS)
      .pipe(
        take(Math.ceil(IT_OS_LIVE_MAX_WAIT_MS / IT_OS_LIVE_POLL_MS)),
        switchMap(() =>
          this.http.post<ItOsGuildHistoryResponse>('/api/it-os-agents/history', { agentId, project, sessionId: session.id, ownerToken: session.ownerToken })
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: ({ messages }) => {
          this.messages.set(messages);
          // Done once the agent has replied and nothing new arrived since the last check.
          if (this.agentReplies(messages) > agentRepliesBefore && messages.length === lastCount) this.settle();
          lastCount = messages.length;
        },
        error: (error: unknown) => this.fail(error),
        complete: () => {
          if (!this.waiting()) return;
          this.waiting.set(false);
          if (this.agentReplies(this.messages()) <= agentRepliesBefore)
            this.error.set('The agent is taking longer than usual. Send another message to check again.');
        },
      });
  }

  private settle(): void {
    this.poll?.unsubscribe();
    this.waiting.set(false);
  }

  private fail(error: unknown): void {
    this.poll?.unsubscribe();
    this.waiting.set(false);
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    if (status === 403) this.error.set('You need write access to this project to use the live agent.');
    else if (status === 503) this.error.set("The live agent isn't available in this environment.");
    else this.error.set("Couldn't reach the agent. Try again.");
  }

  private agentReplies(messages: MktgChatMessage[]): number {
    return messages.filter((m) => m.sender === 'agent').length;
  }
}
