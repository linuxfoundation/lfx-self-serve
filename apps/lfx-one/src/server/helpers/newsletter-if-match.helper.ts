// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { ServiceValidationError } from '../errors';

/**
 * Parse an `If-Match` header into a version integer for lfx-v2-newsletter-service, which sends and
 * accepts a quoted ETag. Accepts the quoted and weak forms the browser client or a proxy may send.
 */
export function parseNewsletterIfMatch(req: Request, operation: string, service: string): number {
  const raw = (req.header('If-Match') || '').trim();
  if (!raw) {
    throw ServiceValidationError.forField('If-Match', 'If-Match header is required', { operation, service, path: req.path });
  }
  const cleaned = raw.replace(/^W\//i, '').replace(/^"|"$/g, '');
  const version = Number(cleaned);
  if (!Number.isFinite(version) || !Number.isInteger(version) || version < 1) {
    throw ServiceValidationError.forField('If-Match', 'If-Match must be a positive integer version', { operation, service, path: req.path });
  }
  return version;
}
