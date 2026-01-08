// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Runtime configuration for client-side IDs injected at container startup.
 * These values are passed via environment variables and made available to the
 * Angular app through SSR's TransferState mechanism.
 */
export interface RuntimeConfig {
  /**
   * LaunchDarkly client-side ID for feature flag evaluation.
   * This is a publicly-publishable ID (safe to expose in browser).
   */
  launchDarklyClientId: string;

  /**
   * DataDog RUM client token for browser monitoring.
   * This is a publicly-publishable token (safe to expose in browser).
   * @future Not yet integrated - placeholder for future use
   */
  dataDogRumClientId: string;

  /**
   * DataDog RUM application ID.
   * @future Not yet integrated - placeholder for future use
   */
  dataDogRumApplicationId: string;
}
