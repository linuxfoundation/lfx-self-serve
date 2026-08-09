// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Osano Consent Manager — the loaded SDK's `window.Osano.cm`. */
export interface OsanoConsentManager {
  /** Opens the cookie-preferences drawer. */
  showDrawer(): void;
}

/**
 * Osano CMP API — models the callable command queue installed by the bootstrap
 * stub plus the `cm` namespace attached once the real script loads. The script
 * attaches this to `window.Osano`.
 */
export interface OsanoFunction {
  (command: 'onInitialized', callback: (consent: unknown) => void): void;
  (command: string, ...args: unknown[]): void;
  /** Consent-manager namespace (present after the real script loads). */
  cm?: OsanoConsentManager;
  /** Queue of buffered calls (populated by the stub before the real script loads). */
  data?: unknown[][];
}
