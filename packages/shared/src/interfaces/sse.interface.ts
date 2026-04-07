// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
