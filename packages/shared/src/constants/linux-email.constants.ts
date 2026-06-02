// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

/**
 * Linux.com email alias add-on constants.
 *
 * The forwarding *domain* is intentionally NOT defined here — it is resolved
 * server-side from the `LINUX_FORWARD_DOMAIN` env var so it can differ per
 * environment (prod `linux.com`, dev/staging `hurrdurr.org`). Only the SFDC
 * product identity and the purchase CTA, which are constant across stages,
 * live in shared code.
 */

/** SFDC product id for the Lifetime Linux.com Email Alias add-on. */
export const LINUX_COM_ADDON_PRODUCT_ID = '01t2M000005wBazQAE';

/** SFDC product id for the prerequisite TLF Individual Supporter membership. */
export const TLF_INDIVIDUAL_SUPPORTER_PRODUCT_ID = '01t2M000005wBb0QAE';

/** membership-ui purchase flow for the add-on (same across stages). */
export const PURCHASE_LINUX_URL = `https://enrollment.lfx.linuxfoundation.org/?project=tlf&product=${LINUX_COM_ADDON_PRODUCT_ID}`;

/** Max length of an alias local part (matches v2 auth-service / forwards-service). */
export const LINUX_ALIAS_MAX_LENGTH = 64;

/**
 * Characters banned in an alias local part (matches v2 services). Includes
 * characters that break RFC 5322 local parts or allow quoted-form bypass.
 */
export const LINUX_ALIAS_BANNED_CHARS = ['"', '/', '*', '$', '^', ':', '@', ' ', ';', '(', ')', '<', '>', '[', ']', ',', '\\'] as const;

/**
 * Reserved alias local parts rejected by the v2 services (case-insensitive).
 * Kept in sync so the client rejects them before the round-trip; `check_alias`
 * / `add_alias` remain the source of truth.
 */
export const LINUX_ALIAS_RESERVED_NAMES = [
  'postmaster',
  'abuse',
  'hostmaster',
  'admin',
  'administrator',
  'noreply',
  'no-reply',
  'root',
  'mailer-daemon',
  'linux',
  'linuxfoundation',
  'lf',
  'security',
  'support',
  'info',
  'webmaster',
  'ops',
  'devops',
  'itx-system',
] as const;
