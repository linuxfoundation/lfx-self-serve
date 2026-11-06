// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgChatMessage } from './mktg-chat.interface';

// Contract for the IT OS live agent route (#4257). Dev only: the server refuses every call unless
// GUILD_IT_OS_WORKSPACE_NAME and GUILD_IT_OS_API_KEY are set, and they are set only in the dev deployment.

/** POST /api/it-os-agents/chat body. */
export interface ItOsGuildChatRequest {
  /** Which IT OS agent to talk to, e.g. `domains`. */
  agentId: string;
  /** LFX project uid. The server checks write access and passes the project's slug to the agent itself. */
  project: string;
  message: string;
  /** Omit to start a new session. */
  sessionId?: string;
  /** Returned when the session was created; required for follow-ups. */
  ownerToken?: string;
}

/** POST /api/it-os-agents/chat response. */
export interface ItOsGuildChatResponse {
  sessionId?: string;
  ownerToken?: string;
  success?: boolean;
}

/** POST /api/it-os-agents/history body. */
export interface ItOsGuildHistoryRequest {
  agentId: string;
  project: string;
  sessionId: string;
  ownerToken: string;
}

/** POST /api/it-os-agents/history response. */
export interface ItOsGuildHistoryResponse {
  messages: MktgChatMessage[];
  /** True once the agent has finished its latest turn (its runtime has closed), not just paused between messages. */
  turnComplete: boolean;
  /** True when the session has too many events to follow its latest turn; the user should start a new conversation. */
  sessionTooLong: boolean;
}

/** GET /api/it-os-agents/status response: which IT OS agents can be reached live here. Empty outside dev. */
export interface ItOsGuildStatusResponse {
  agents: string[];
}
