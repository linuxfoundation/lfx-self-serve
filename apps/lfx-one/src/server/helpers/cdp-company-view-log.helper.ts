// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CDP_COMPANY_VIEW_VIEWER_HKDF_INFO, CDP_VIEW_OUTCOME_LOCALS_KEY } from '@lfx-one/shared/constants';
import type { CdpSectionKey, CdpViewOutcome } from '@lfx-one/shared/interfaces';
import type { Request, Response } from 'express';
import { createHmac, hkdfSync } from 'node:crypto';

import { logger } from '../services/logger.service';
import { getEffectiveSub } from '../utils/auth-helper';

/**
 * The `viewer` of a `cdp_company_view` event (FR-015, DR-050): `base64url(HMAC-SHA256(key, sub))` over the effective
 * subject (a "view as" session's target, never the operator), with the key derived from `PCC_AUTH0_SECRET` by HKDF
 * under its own info label. Stable per person, so an audit can follow one viewer and, holding the secret, test a known
 * subject; unreadable otherwise. LFID subjects are `auth0|<username>`, so the raw `sub` would expose the handle and is
 * never logged. Null when there is no subject or no secret: the event then names no viewer rather than fall back to
 * the raw value or a public key.
 */
export function cdpCompanyViewer(req: Request): string | null {
  const sub = getEffectiveSub(req);
  const secret = process.env['PCC_AUTH0_SECRET'];
  if (!sub || !secret) return null;
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), CDP_COMPANY_VIEW_VIEWER_HKDF_INFO, 32));
  return createHmac('sha256', key).update(sub).digest('base64url');
}

/**
 * FR-015, DR-022, DR-050 — exactly one `cdp_company_view` event per page or section response, emitted when the
 * response finishes, after the audience check and id validation: `{viewer, cdp_id, section, outcome}`. The viewer is
 * only the keyed pseudonym above; no username, email or raw `sub` is logged.
 */
export function logCdpCompanyViewOnFinish(req: Request, res: Response, cdpId: string, section: CdpSectionKey | 'page'): void {
  res.once('finish', () => {
    const outcome = (res.locals[CDP_VIEW_OUTCOME_LOCALS_KEY] as CdpViewOutcome | undefined) ?? 'error';
    logger.info(req, 'cdp_company_view', 'CDP company viewed', {
      viewer: cdpCompanyViewer(req),
      cdp_id: cdpId,
      section,
      outcome,
    });
  });
}
