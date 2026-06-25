// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Chat contract shared between the Angular app and the Express Guild proxy
// for the Marketing OS Agents marketplace (LFXAI-95 workstream).

/** A single chat message, as mapped from Guild session events. */
export interface MktgChatMessage {
  /** Guild event id. */
  id: string;
  /** Who authored the message. */
  sender: 'user' | 'agent';
  /** Display text (routing prefix stripped for user messages). */
  text: string;
  /**
   * Pre-formatted `HH:MM` timestamp. Formatted server-side, so it reflects the
   * server's timezone (UTC in deployed envs), not the viewer's. Per-viewer
   * localization is deferred to the client chat panel (LFXAI-99).
   */
  timestamp: string;
}

/** Identifies a persisted Guild chat session for a given agent. */
export interface MktgSessionInfo {
  /** Catalog agent id this session belongs to. */
  agentId: string;
  /** Guild session id returned on session creation. */
  sessionId: string;
}

/**
 * Request body for `POST /api/mktg-agents/chat`.
 * Omit/null `sessionId` to create a new session; provide it to post a follow-up.
 */
export interface MktgChatRequest {
  /** Catalog agent id; resolved server-side to a Guild routing handle. */
  agentId: string;
  /** User message text. */
  message: string;
  /** Existing Guild session id, or null/omitted to start a new session. */
  sessionId?: string | null;
}

/**
 * Response from `POST /api/mktg-agents/chat`.
 * New session → `{ sessionId }`; follow-up on an existing session → `{ success: true }`.
 */
export interface MktgChatResponse {
  /** Present when a new session was created. */
  sessionId?: string;
  /** Present (true) when a follow-up was posted to an existing session. */
  success?: boolean;
}

/** Response from `GET /api/mktg-agents/history`. */
export interface MktgHistoryResponse {
  /** Messages sorted chronologically (oldest first). */
  messages: MktgChatMessage[];
}
