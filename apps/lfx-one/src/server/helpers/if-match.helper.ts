// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { ServiceValidationError } from '../errors';

/**
 * Parses the client-supplied `If-Match` header for a formation write route (GH-2576 Phase 2).
 * `lfx-v2-formation-service`'s `if_match` is a Goa `Int64`, decoded from a bare-digit string — a
 * quoted entity-tag (`"5"`) or a weak validator (`W/"5"`) is refused at upstream decode, so this
 * deliberately does NOT strip/normalize those forms the way `newsletter.controller.ts`'s
 * `parseIfMatch` does for its own (differently-shaped) upstream contract. A caller sending a quoted
 * value here is itself a bug worth surfacing as a clear 400, not silently fixing.
 *
 * Returns the header's own digit string (not round-tripped through `Number`) so a large Int64
 * version can't lose precision, and forwards unquoted to upstream — matching the wire format
 * `formation.service.ts`'s existing mutation transports already use (`{ 'If-Match': String(version) }`).
 */
export function parseIfMatch(req: Request, operation: string): string {
  const raw = (req.header('If-Match') || '').trim();
  if (!raw) {
    throw ServiceValidationError.forField('If-Match', 'If-Match header is required', {
      operation,
      service: 'formation_service',
      path: req.path,
    });
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw ServiceValidationError.forField('If-Match', 'If-Match must be a bare positive integer version, not a quoted or weak entity-tag', {
      operation,
      service: 'formation_service',
      path: req.path,
    });
  }
  return raw;
}
