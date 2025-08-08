// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface ApiClientConfig {
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface MicroserviceUrls {
  LFX_V2_SERVICE: string;
}

export interface ApiError extends Error {
  status?: number;
  code?: string;
  service?: string;
  path?: string;
  originalMessage?: string;
}

export interface ApiErrorOptions {
  message: string;
  status?: number;
  code?: string;
  service?: string;
  path?: string;
  originalMessage?: string;
  originalError?: Error;
  response?: any;
}

export interface QueryServiceItem<T = unknown> {
  type: string;
  id: string;
  data: T;
}

export type QueryServiceResponse<T = unknown> = QueryServiceItem<T>[];
