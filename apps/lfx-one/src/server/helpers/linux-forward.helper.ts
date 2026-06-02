// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

/**
 * Resolve the active Linux.com forwarding domain for this environment.
 *
 * The v2 forwards-service and auth-service require the caller to supply the
 * domain explicitly on every request, and gate it against their own server-side
 * allow-lists (`FORWARDS_DOMAINS` / `ALLOWED_ALIAS_DOMAINS`). We mirror that
 * here so the same code runs in every stage: prod uses `linux.com`, dev/staging
 * set `LINUX_FORWARD_DOMAIN=hurrdurr.org`. The value must line up with the two
 * upstream allow-lists or claims fail with `domain_not_allowed`.
 */
export function getLinuxForwardDomain(): string {
  return (process.env['LINUX_FORWARD_DOMAIN'] || 'linux.com').trim().toLowerCase();
}
