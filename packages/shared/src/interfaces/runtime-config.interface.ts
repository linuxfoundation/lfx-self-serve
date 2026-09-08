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

  /**
   * Backend service URLs for DataDog RUM allowed tracing.
   * Passed from server-side environment variables (e.g., LFX_V2_SERVICE).
   */
  allowedTracingUrls: string[];

  /**
   * Publicly-publishable Intercom workspace ID. Per-user identity comes from
   * the `http://lfx.dev/claims/intercom` Auth0 claim, passed to Intercom as
   * `intercom_user_jwt`.
   */
  intercomAppId: string;

  /**
   * Stripe publishable key for client-side Stripe Elements integration.
   * Safe to expose in the browser — see https://stripe.com/docs/keys
   */
  stripePublishableKey: string;

  /**
   * Supabase project URL for the embedded Gatewaze admin pilot (`GwModuleOutletComponent`,
   * `/foundation/gw`). Publicly-publishable per Supabase's own client-key model — the anon key
   * below carries no privileged access on its own.
   *
   * ASSUMPTION (ticket context did not include real Gatewaze/Supabase project values): empty
   * string until a real pilot project exists. `GwModuleOutletComponent` treats an empty value as
   * "not configured" rather than passing a broken URL to the embed.
   */
  gwSupabaseUrl: string;

  /**
   * Supabase anonymous/public API key paired with {@link gwSupabaseUrl}. Safe to expose in the
   * browser — see Supabase's docs on the anon key.
   *
   * ASSUMPTION: same caveat as `gwSupabaseUrl` — empty until a real pilot project exists.
   */
  gwSupabaseAnonKey: string;

  /**
   * LFID (LF SSO) sign-in start URL the embed redirects to when it needs the user to
   * (re-)authenticate. ASSUMPTION: no confirmed value for the pilot yet; empty until provided.
   */
  gwLfidStartUrl: string;
}
