// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// SSE event types from our Express server to the client
export type LensSSEEventType = 'status' | 'block' | 'content' | 'session_id' | 'done' | 'error';

// Block types from LFX Lens API response
export type LensBlockType = 'message' | 'sql' | 'suggestions';

export interface LensMessageBlock {
  type: 'message';
  content: string;
}

export interface LensSqlBlock {
  type: 'sql';
  title: string;
  description: string;
  sql: string;
  explanation: string | null;
  result: {
    data: Record<string, unknown>[];
    columns: string[];
    rowCount: number;
  } | null;
}

export interface LensSuggestionsBlock {
  type: 'suggestions';
  items: string[];
}

export type LensBlock = LensMessageBlock | LensSqlBlock | LensSuggestionsBlock;

// What the frontend stores per conversation turn
export interface LensMessage {
  role: 'user' | 'assistant';
  content: string;
  blocks: LensBlock[];
  loading: boolean;
}

// Context passed from dashboards (maps to API's additional_data)
export interface LensContext {
  company?: { id: string; name?: string };
  project?: { slug: string; name?: string };
}

// Request body from Angular to Express
export interface LensChatRequest {
  message: string;
  sessionId?: string;
  context?: LensContext;
}

// The full LFX Lens API response (sync mode)
export interface LfxLensApiResponse {
  content: { blocks: LensBlock[] };
  session_id: string;
  status: 'COMPLETED' | 'ERROR';
  run_id: string;
  metrics?: {
    duration: number;
    steps: Record<string, { metrics: { input_tokens: number; output_tokens: number; duration: number } }>;
  };
}

// Server-side query parameters for the Lens service
export interface LensQueryParams {
  message: string;
  userId: string;
  sessionId?: string;
  context?: LensContext;
}

// Server-side SSE event emitted by the Lens service
export interface LensSSEEvent {
  type: LensSSEEventType;
  data: unknown;
}

// Express response extended with flush for compression middleware
export interface FlushableResponse {
  flush?: () => void;
}

// Generic SSE event structure for the frontend
export interface SSEEvent<T extends string = string> {
  type: T;
  data: unknown;
}

// SSE connection options for the frontend
export interface SSEConnectOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}
