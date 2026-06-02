// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

/**
 * Linux.com (vanity) email alias forwarding.
 *
 * The feature is backed by two v2 NATS services:
 * - auth-service `add_alias` — claims `<alias>@<domain>` as a system-managed
 *   Auth0 linked identity (immutable; surfaces in `user_emails.read`).
 * - forwards-service `check_alias` / `set_target` / `get_forward` — stateless
 *   proxy to forwardemail.net that owns the routing to a destination address.
 *
 * The forwarding domain is environment-specific (prod `linux.com`,
 * dev/staging `hurrdurr.org`) and is resolved server-side, then returned to the
 * client in `LinuxAliasData.domain`. The UI never assumes a literal domain.
 */

/** The four states the Linux.com email tab can render. */
export type LinuxAliasState = 'not_purchased' | 'purchased_unclaimed' | 'claimed' | 'service_unavailable';

/** Aggregate state returned by `GET /api/profile/linux-email`. */
export interface LinuxAliasData {
  state: LinuxAliasState;
  /** Active forwarding domain, env-driven (e.g. `linux.com` or `hurrdurr.org`). */
  domain: string;
  /** Local part of the claimed alias (e.g. `jsmith`), or null when unclaimed. */
  alias: string | null;
  /** Full claimed address `${alias}@${domain}`, or null when unclaimed. */
  email: string | null;
  /** Current forwarding destination, or null when not yet set. */
  forwardTo: string | null;
  /** membership-ui CTA URL, present only in the `not_purchased` state. */
  purchaseUrl?: string;
}

/** Body for `POST /api/profile/linux-email/claim`. */
export interface ClaimAliasRequest {
  alias: string;
  forwardTo: string;
}

/** Body for `PUT /api/profile/linux-email/forward`. */
export interface UpdateForwardRequest {
  forwardTo: string;
}

/** A selectable forwarding destination (one of the user's verified emails). */
export interface LinuxForwardOption {
  label: string;
  value: string;
}

// --- NATS contract types (mirror the v2 service reply payloads) ---

/** Reply from forwards-service `check_alias`. */
export interface CheckAliasNatsResponse {
  exists?: boolean;
  alias?: string;
  error?: string;
}

/** Reply from auth-service `add_alias`. */
export interface AddAliasNatsResponse {
  success: boolean;
  email?: string;
  error?: string;
}

/** Reply from forwards-service `set_target`. */
export interface SetTargetNatsResponse {
  alias?: string;
  target_email?: string;
  updated_at?: string;
  error?: string;
}

/** Reply from forwards-service `get_forward`. */
export interface GetForwardNatsResponse {
  found?: boolean;
  alias?: string;
  target_email?: string;
  error?: string;
}
