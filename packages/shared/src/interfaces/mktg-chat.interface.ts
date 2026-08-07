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
   * Pre-formatted `HH:MM` timestamp in **UTC** — built server-side as a
   * deterministic, locale-independent string. Empty (`''`) when the upstream
   * `created_at` is missing or invalid. Per-viewer localization is deferred to
   * the client chat panel (LFXAI-99).
   */
  timestamp: string;
}

/** Identifies a persisted Guild chat session for a given agent. */
export interface MktgSessionInfo {
  /** Catalog agent id this session belongs to. */
  agentId: string;
  /** Guild session id returned on session creation. */
  sessionId: string;
  /**
   * Opaque owner token proving the current user created this session. Required
   * to post follow-up messages; the browser stores it alongside the sessionId.
   */
  ownerToken: string;
}

/**
 * A chat session as persisted client-side (localStorage) for the "Past Chats"
 * drawer. Carries the `ownerToken` needed to post follow-ups plus presentation
 * metadata (`title`, `createdAt`) that the server history endpoint does not
 * return. Stored per-agent: `Record<agentId, MktgChatSession[]>`.
 */
export interface MktgChatSession {
  /** Guild session id returned on session creation. */
  sessionId: string;
  /** Owner token from the create response; required to post follow-ups. */
  ownerToken: string;
  /** Display label for the drawer — derived from the first user message. */
  title: string;
  /** ISO-8601 creation timestamp, used to order and label sessions. */
  createdAt: string;
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
  /**
   * Owner token from the original create response, required when posting a
   * follow-up to an existing `sessionId`. Proves the caller created the session;
   * the server rejects follow-ups whose token doesn't match the caller.
   */
  ownerToken?: string;
}

/**
 * Response from `POST /api/mktg-agents/chat`.
 * New session → `{ sessionId, ownerToken }`; follow-up → `{ success: true }`.
 * Modeled as a union of the two real shapes so exactly one is returned — never
 * `{}` or both at once. Consumers narrow with `'sessionId' in response`.
 */
export type MktgChatResponse = { sessionId: string; ownerToken: string } | { success: true };

/** Response from `GET /api/mktg-agents/history`. */
export interface MktgHistoryResponse {
  /** Messages sorted chronologically (oldest first). */
  messages: MktgChatMessage[];
}

/**
 * Minimal shape of a Guild session event — the upstream API response fields the
 * proxy consumes when mapping history. Part of the Guild chat contract.
 */
export interface GuildSessionEvent {
  /** Guild event id. */
  id: string;
  /** Event type (e.g. `trigger_message`, `user_message`, `agent_notification_message`). */
  type: string;
  /** ISO-8601 creation timestamp. */
  created_at: string;
  /** Event content — a bare string, or an object with a content type + data. */
  content?: { type?: string; data?: string } | string;
}
