// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { MicroserviceError } from '../errors';

/**
 * Resolve the active Linux.com forwarding domain for this environment.
 *
 * The v2 forwards-service and auth-service require the caller to supply the
 * domain explicitly on every request, and gate it against their own server-side
 * allow-lists (`FORWARDS_DOMAINS` / `ALLOWED_ALIAS_DOMAINS`). The domain is
 * read from `LINUX_FORWARD_DOMAIN`, which must be set in every stage (prod
 * `linux.com`, dev/staging e.g. `example.org`) and line up with the two upstream
 * allow-lists, or claims fail with `domain_not_allowed`.
 *
 * Fails fast with a 503 when the env var is missing, mirroring
 * `getApiGatewayBaseUrl`, so a misconfiguration surfaces immediately rather than
 * silently defaulting to a domain the upstream may reject.
 */
export function getLinuxForwardDomain(operation: string, service: string): string {
  const domain = (process.env['LINUX_FORWARD_DOMAIN'] || '').trim().toLowerCase();

  if (!domain) {
    throw new MicroserviceError('LINUX_FORWARD_DOMAIN environment variable is not configured', 503, 'LINUX_FORWARD_DOMAIN_MISCONFIGURED', {
      operation,
      service,
    });
  }

  return domain;
}
