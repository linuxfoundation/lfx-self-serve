// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { MktgChatSession } from '@lfx-one/shared/interfaces';

// localStorage keys for the Marketing OS chat panel (LFXAI-99). Names ported
// from the guild_embed prototype so existing local sessions keep working.
const ACTIVE_SESSION_IDS_KEY = 'guild_active_session_ids';
const AGENT_SESSIONS_KEY = 'guild_agent_sessions';

/**
 * Browser-only persistence for Marketing OS chat sessions.
 *
 * Sessions are a UX convenience (the "Past Chats" drawer) and a place to keep
 * each session's `ownerToken` for follow-ups — they are NOT a security boundary
 * (the server independently verifies the owner token on every write). All access
 * is guarded by `isPlatformBrowser` so SSR renders an empty, side-effect-free
 * panel. A corrupt/unreadable store degrades to empty rather than throwing.
 */
@Injectable({ providedIn: 'root' })
export class MktgChatSessionService {
  private readonly platformId = inject(PLATFORM_ID);

  /** The active session id for an agent, or null when none is selected. */
  public getActiveSessionId(agentId: string): string | null {
    return this.readMap(ACTIVE_SESSION_IDS_KEY)[agentId] ?? null;
  }

  /** Set (or clear, when `sessionId` is null) the active session for an agent. */
  public setActiveSessionId(agentId: string, sessionId: string | null): void {
    const map = this.readMap(ACTIVE_SESSION_IDS_KEY);
    if (sessionId) {
      map[agentId] = sessionId;
    } else {
      delete map[agentId];
    }
    this.writeJson(ACTIVE_SESSION_IDS_KEY, map);
  }

  /** All persisted sessions for an agent (most recent first). */
  public getSessions(agentId: string): MktgChatSession[] {
    return this.readSessions()[agentId] ?? [];
  }

  /** A single session by id, used to recover its `ownerToken` for follow-ups. */
  public getSession(agentId: string, sessionId: string): MktgChatSession | undefined {
    return this.getSessions(agentId).find((session) => session.sessionId === sessionId);
  }

  /** Prepend a newly created session to an agent's list. */
  public addSession(agentId: string, session: MktgChatSession): void {
    const all = this.readSessions();
    all[agentId] = [session, ...(all[agentId] ?? []).filter((existing) => existing.sessionId !== session.sessionId)];
    this.writeJson(AGENT_SESSIONS_KEY, all);
  }

  /** Remove a session from an agent's list; clears the active id if it matched. */
  public removeSession(agentId: string, sessionId: string): void {
    const all = this.readSessions();
    all[agentId] = (all[agentId] ?? []).filter((existing) => existing.sessionId !== sessionId);
    this.writeJson(AGENT_SESSIONS_KEY, all);

    if (this.getActiveSessionId(agentId) === sessionId) {
      this.setActiveSessionId(agentId, null);
    }
  }

  private readSessions(): Record<string, MktgChatSession[]> {
    return this.readMap<MktgChatSession[]>(AGENT_SESSIONS_KEY);
  }

  private readMap<T = string>(key: string): Record<string, T> {
    if (!isPlatformBrowser(this.platformId)) {
      return {};
    }
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, T>) : {};
    } catch {
      return {};
    }
  }

  private writeJson(key: string, value: unknown): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota exceeded or storage unavailable — sessions are best-effort.
    }
  }
}
