// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// SSE event types from our Express server to the client
export type CopilotSSEEventType = 'status' | 'block' | 'content' | 'session_id' | 'done' | 'error';

// Frontend loading stages derived from upstream stream events
export type CopilotStreamStage = 'starting' | 'analyzing' | 'querying' | 'preparing' | 'complete';

// Block types from LFX Copilot API response
export type CopilotBlockType = 'message' | 'sql' | 'suggestions';

export interface CopilotMessageBlock {
  type: 'message';
  content: string;
}

export interface CopilotSqlBlock {
  type: 'sql';
  sql: string;
  result: {
    data: Record<string, unknown>[];
    columns: string[];
    rowCount: number;
  } | null;
}

export interface CopilotSuggestionsBlock {
  type: 'suggestions';
  items: string[];
}

export type CopilotBlock = CopilotMessageBlock | CopilotSqlBlock | CopilotSuggestionsBlock;

// What the frontend stores per conversation turn
export interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
  blocks: CopilotBlock[];
  loading: boolean;
}

// Context passed from dashboards (maps to API's additional_data)
export interface CopilotContext {
  foundation: { slug: string; name: string };
  company?: { id: string; name?: string };
}

// Request body from Angular to Express
export interface CopilotChatRequest {
  message: string;
  sessionId?: string;
  context?: CopilotContext;
}

// The full LFX Copilot API response (sync mode)
export interface LfxCopilotApiResponse {
  content: { blocks: CopilotBlock[] };
  session_id: string;
  status: 'COMPLETED' | 'ERROR';
  run_id: string;
  metrics?: {
    duration: number;
    steps: Record<string, { metrics: { input_tokens: number; output_tokens: number; duration: number } }>;
  };
}

// Server-side query parameters for the Copilot service
export interface CopilotQueryParams {
  message: string;
  userId: string;
  sessionId?: string;
  context?: CopilotContext;
}

// Server-side SSE event emitted by the Copilot service
export interface CopilotSSEEvent {
  type: CopilotSSEEventType;
  data: unknown;
}

// Visual config for a loading stage
export interface CopilotStageConfig {
  stage: CopilotStreamStage;
  label: string;
  dotColor: string;
}

// Stage config extended with runtime status
export interface CopilotStageStatus extends CopilotStageConfig {
  status: 'pending' | 'active' | 'completed';
}
