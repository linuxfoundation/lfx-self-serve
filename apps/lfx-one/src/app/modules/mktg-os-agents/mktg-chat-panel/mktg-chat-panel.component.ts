// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, OnDestroy, OnInit, output, PLATFORM_ID, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MktgAgent, MktgChatMessage, MktgChatSession } from '@lfx-one/shared/interfaces';
import { catchError, of, Subscription, switchMap, take, takeUntil, timer } from 'rxjs';

import { MktgAgentsService } from '../../../shared/services/mktg-agents.service';
import { MktgChatSessionService } from '../../../shared/services/mktg-chat-session.service';

// Poll the history endpoint while waiting for the agent to reply (MVP substitute
// for streaming — see LFXAI-99). Cadence is a balance between responsiveness and
// load on the Guild proxy; the deadline caps a single send's wait.
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;

// Max length of the first user message used as a session's drawer title.
const SESSION_TITLE_MAX_LENGTH = 28;

/**
 * Per-agent chat surface for the Marketing OS marketplace (LFXAI-99).
 *
 * Opened in place of the marketplace grid for a single `active` agent. Talks to
 * the BFF Guild proxy via `MktgAgentsService` and waits for replies by polling
 * the history endpoint (no SSE/WebSocket in the MVP). Sessions persist in
 * localStorage through `MktgChatSessionService`; all browser access is guarded
 * so the panel renders inert under SSR.
 */
@Component({
  selector: 'lfx-mktg-chat-panel',
  imports: [NgClass, ReactiveFormsModule, ButtonComponent, InputTextComponent],
  templateUrl: './mktg-chat-panel.component.html',
})
export class MktgChatPanelComponent implements OnInit, OnDestroy {
  // === Injections ===
  private readonly platformId = inject(PLATFORM_ID);
  private readonly mktgAgents = inject(MktgAgentsService);
  private readonly sessionStore = inject(MktgChatSessionService);

  // === Inputs / Outputs ===
  // Only `active` agents are routable; the marketplace never opens a panel for
  // a `coming-soon` tile, so the chat handle is guaranteed server-side.
  public readonly agent = input.required<MktgAgent>();
  public readonly back = output<void>();

  // === Forms ===
  protected readonly chatForm = new FormGroup({
    message: new FormControl('', { nonNullable: true }),
  });

  // === Signals ===
  protected readonly messages = signal<MktgChatMessage[]>([]);
  protected readonly sessions = signal<MktgChatSession[]>([]);
  protected readonly activeSessionId = signal<string | null>(null);
  protected readonly isTyping = signal(false);
  protected readonly isHistoryLoading = signal(false);
  protected readonly showSessions = signal(true);

  // === Computed ===
  // Header tag list joined once per agent change — keeps `join()` out of the template.
  protected readonly tagsLabel = computed(() => this.agent().tags.join(' · '));

  // In-flight history fetch (load or poll) and the in-flight send POST. Both are
  // cancelled on agent/session switch and on destroy (via cancelInFlight) so a
  // stale response can never overwrite a newer conversation or write to a
  // destroyed component.
  private historySub: Subscription | null = null;
  private sendSub: Subscription | null = null;
  private optimisticCounter = 0;

  // === Lifecycle ===
  public ngOnInit(): void {
    // SSR renders an empty panel — no localStorage, no network.
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const agentId = this.agent().id;
    this.sessions.set(this.sessionStore.getSessions(agentId));

    const savedSessionId = this.sessionStore.getActiveSessionId(agentId);
    if (savedSessionId) {
      this.activeSessionId.set(savedSessionId);
      this.loadHistory(savedSessionId);
    }
  }

  public ngOnDestroy(): void {
    this.cancelInFlight();
  }

  // === Protected actions (template) ===
  protected onSubmit(): void {
    const text = this.chatForm.controls.message.value.trim();
    if (!text || this.isTyping() || this.isHistoryLoading()) {
      return;
    }

    this.chatForm.controls.message.setValue('');
    const agentId = this.agent().id;
    const sessionId = this.activeSessionId();

    // Optimistic user bubble — replaced by the canonical server copy once the
    // agent replies and the full history is reloaded, or rolled back on failure.
    const optimistic = this.buildMessage('user', text);
    this.messages.update((list) => [...list, optimistic]);
    this.setTyping(true);

    const agentMessageBaseline = this.countAgentMessages();
    const ownerToken = sessionId ? this.sessionStore.getSession(agentId, sessionId)?.ownerToken : undefined;

    this.sendSub = this.mktgAgents
      .sendMessage({ agentId, message: text, sessionId: sessionId ?? null, ownerToken })
      .pipe(take(1))
      .subscribe({
        next: (response) => {
          if ('sessionId' in response) {
            this.onSessionCreated(agentId, response.sessionId, response.ownerToken, text, agentMessageBaseline);
          } else if (sessionId) {
            this.pollForReply(sessionId, agentMessageBaseline);
          } else {
            // New-session request but the server returned the follow-up shape:
            // there is no sessionId to poll, so fail soft instead of leaving the
            // input wedged with `isTyping` stuck on.
            this.handleSendError('unexpected follow-up response for a new session', text, optimistic.id);
          }
        },
        error: (error) => this.handleSendError(error, text, optimistic.id),
      });
  }

  protected onSelectSession(sessionId: string): void {
    if (sessionId === this.activeSessionId()) {
      return;
    }
    this.cancelInFlight();
    this.setTyping(false);
    this.activeSessionId.set(sessionId);
    this.sessionStore.setActiveSessionId(this.agent().id, sessionId);
    this.loadHistory(sessionId);
  }

  protected onNewChat(): void {
    this.cancelInFlight();
    this.setTyping(false);
    this.activeSessionId.set(null);
    this.messages.set([]);
    this.sessionStore.setActiveSessionId(this.agent().id, null);
  }

  protected onDeleteSession(sessionId: string): void {
    const agentId = this.agent().id;
    this.sessionStore.removeSession(agentId, sessionId);
    this.sessions.update((list) => list.filter((session) => session.sessionId !== sessionId));

    if (this.activeSessionId() !== sessionId) {
      return;
    }

    // Deleting the open session: fall back to the most recent remaining one.
    this.cancelInFlight();
    this.setTyping(false);
    const next = this.sessions()[0]?.sessionId ?? null;
    this.activeSessionId.set(next);
    this.sessionStore.setActiveSessionId(agentId, next);
    if (next) {
      this.loadHistory(next);
    } else {
      this.messages.set([]);
    }
  }

  protected onToggleSessions(): void {
    this.showSessions.update((shown) => !shown);
  }

  protected onBack(): void {
    this.back.emit();
  }

  // === Private helpers ===
  private onSessionCreated(agentId: string, sessionId: string, ownerToken: string, firstMessage: string, agentMessageBaseline: number): void {
    const session: MktgChatSession = {
      sessionId,
      ownerToken,
      title: this.toTitle(firstMessage),
      createdAt: new Date().toISOString(),
    };
    this.sessionStore.addSession(agentId, session);
    this.sessionStore.setActiveSessionId(agentId, sessionId);
    this.sessions.update((list) => [session, ...list.filter((existing) => existing.sessionId !== sessionId)]);
    this.activeSessionId.set(sessionId);
    this.pollForReply(sessionId, agentMessageBaseline);
  }

  /** Load and display a session's full history; recover gracefully if it expired. */
  private loadHistory(sessionId: string): void {
    this.cancelInFlight();
    this.setHistoryLoading(true);
    this.historySub = this.mktgAgents.getHistory(sessionId).subscribe({
      next: (messages) => {
        this.setHistoryLoading(false);
        this.messages.set(messages);
      },
      error: (error) => {
        console.error('[mktg-chat] failed to load session history', error);
        this.setHistoryLoading(false);
        if (isSessionGoneError(error)) {
          // Genuinely missing/expired upstream — safe to drop locally.
          this.handleExpiredSession(sessionId);
        } else {
          // Transient or server error: keep the session (and its ownerToken)
          // intact so the user can still post follow-ups; show a non-destructive
          // notice instead of silently deleting a valid conversation.
          this.messages.set([
            this.buildMessage('agent', 'Couldn’t load this conversation right now. It’s still saved — reopen it or send a message to try again.'),
          ]);
        }
      },
    });
  }

  /**
   * Poll history until a new agent message lands (or the deadline passes), then
   * swap in the canonical server history. A transient fetch error is swallowed
   * so a single hiccup doesn't abort the wait.
   */
  private pollForReply(sessionId: string, agentMessageBaseline: number): void {
    this.cancelInFlight();
    const deadline$ = timer(POLL_TIMEOUT_MS);

    this.historySub = timer(POLL_INTERVAL_MS, POLL_INTERVAL_MS)
      .pipe(
        switchMap(() =>
          this.mktgAgents.getHistory(sessionId).pipe(
            catchError((error) => {
              // Swallow transient poll errors so a single hiccup doesn't abort the
              // wait; the loop retries on the next tick.
              console.warn('[mktg-chat] history poll failed, retrying', error);
              return of(null);
            })
          )
        ),
        takeUntil(deadline$)
      )
      .subscribe({
        next: (messages) => {
          if (!messages) {
            return;
          }
          const agentMessages = messages.filter((message) => message.sender === 'agent').length;
          if (agentMessages > agentMessageBaseline) {
            this.messages.set(messages);
            this.setTyping(false);
            this.cancelInFlight();
          }
        },
        complete: () => {
          // Reached only when the deadline fires first — a reply unsubscribes via
          // cancelInFlight() before the timer can complete.
          if (this.isTyping()) {
            this.setTyping(false);
            this.messages.update((list) => [
              ...list,
              this.buildMessage('agent', 'The agent is taking longer than usual to respond. Your message was sent — check back shortly.'),
            ]);
          }
        },
      });
  }

  private handleExpiredSession(sessionId: string): void {
    const agentId = this.agent().id;
    this.sessionStore.removeSession(agentId, sessionId);
    this.sessions.update((list) => list.filter((session) => session.sessionId !== sessionId));
    this.activeSessionId.set(null);
    this.messages.set([this.buildMessage('agent', 'This conversation could not be found — it may have expired. Send a message to start a new one.')]);
  }

  private cancelInFlight(): void {
    this.historySub?.unsubscribe();
    this.historySub = null;
    // Abandon any in-flight send so its continuation can't poll/swap into the
    // wrong session (switch) or write after teardown (destroy).
    this.sendSub?.unsubscribe();
    this.sendSub = null;
  }

  // The "busy" signals and the input lock are written together so the message
  // control is always disabled exactly when the Send button is. Done in these
  // setters (not an effect) per the repo's no-effect()-for-side-effects rule.
  private setTyping(value: boolean): void {
    this.isTyping.set(value);
    this.syncInputLock();
  }

  private setHistoryLoading(value: boolean): void {
    this.isHistoryLoading.set(value);
    this.syncInputLock();
  }

  /**
   * Lock the message control while sending or loading. `lfx-input-text` exposes
   * no `disabled` input, so toggle the FormControl directly — this makes the
   * "input is disabled while sending" invariant the draft-restore relies on real.
   */
  private syncInputLock(): void {
    const locked = this.isTyping() || this.isHistoryLoading();
    const control = this.chatForm.controls.message;
    if (locked && control.enabled) {
      control.disable({ emitEvent: false });
    } else if (!locked && control.disabled) {
      control.enable({ emitEvent: false });
    }
  }

  /**
   * Recover from a failed send: roll back the optimistic bubble (the server never
   * received it), restore the user's draft so they can resend without retyping,
   * and surface an inline error. The message control is locked while sending (see
   * the constructor effect), so no new input can have accumulated — restoring the
   * draft can't clobber anything the user typed.
   */
  private handleSendError(error: unknown, draft: string, optimisticId: string): void {
    console.error('[mktg-chat] failed to send message', error);
    this.setTyping(false);
    this.messages.update((list) => list.filter((message) => message.id !== optimisticId));
    this.chatForm.controls.message.setValue(draft);
    this.messages.update((list) => [...list, this.buildMessage('agent', 'Sorry — that message could not be sent. Please try again.')]);
  }

  private countAgentMessages(): number {
    return this.messages().filter((message) => message.sender === 'agent').length;
  }

  private buildMessage(sender: MktgChatMessage['sender'], text: string): MktgChatMessage {
    this.optimisticCounter += 1;
    return { id: `local-${sender}-${this.optimisticCounter}`, sender, text, timestamp: this.nowUtcHhMm() };
  }

  private toTitle(message: string): string {
    return message.length > SESSION_TITLE_MAX_LENGTH ? `${message.slice(0, SESSION_TITLE_MAX_LENGTH)}…` : message;
  }

  /** UTC `HH:MM`, matching the server-side timestamp format for mapped history. */
  private nowUtcHhMm(): string {
    const now = new Date();
    return `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
  }
}

/**
 * True only when the upstream genuinely reports the session as gone (404/410),
 * so a transient network/5xx error never triggers destructive local cleanup.
 */
function isSessionGoneError(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 404 || error.status === 410);
}
