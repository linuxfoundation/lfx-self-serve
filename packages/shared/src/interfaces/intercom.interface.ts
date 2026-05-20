// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Intercom Messenger boot options. `intercom_user_jwt` is the Auth0 JWT for identity verification. */
export interface IntercomBootOptions {
  api_base?: string;
  app_id: string;
  user_id?: string;
  name?: string;
  email?: string;
  created_at?: number;
  intercom_user_jwt?: string;
  [key: string]: unknown;
}

/** Intercom settings stored on `window.intercomSettings`. */
export type IntercomSettings = Partial<IntercomBootOptions>;

/** Intercom API — models the loaded SDK function and the pre-load queue stub. */
export interface IntercomFunction {
  (command: 'boot', options: IntercomBootOptions): void;
  (command: 'show'): void;
  (command: 'shutdown'): void;
  (command: 'reattach_activator'): void;
  (command: string, ...args: unknown[]): void;
  /** Queue of buffered calls (populated by the stub before the real script loads). */
  q?: unknown[][];
  /** Push function used by the stub to enqueue calls. */
  c?: (args: unknown[]) => void;
}
