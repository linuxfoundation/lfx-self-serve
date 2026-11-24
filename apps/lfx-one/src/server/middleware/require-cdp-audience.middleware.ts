// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CDP_AUDIENCE_LOCALS_KEY, CDP_COMPANY_ERROR_CODES } from '@lfx-one/shared/constants';
import type { CdpAudienceAnswer, CdpCompanyErrorBody } from '@lfx-one/shared/interfaces';
import type { NextFunction, Request, Response } from 'express';

import { resolveCdpAudience } from '../helpers/cdp-audience.helper';

/**
 * Gate of every CDP company route but `/availability`. Runs before the id is
 * parsed and before any cache or warehouse read. Outside the audience answers exactly what an unknown address
 * answers (404 `NOT_FOUND`); an unverifiable check answers 503 `ROLE_GRANTS_UNAVAILABLE`. Inside,
 * the answer is stored on `res.locals` so Meetings and Groups read `lf-staff` from the same batch.
 */
export async function requireCdpAudience(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const answer = await resolveCdpAudience(req);
    if (answer.status === 'in') {
      res.locals[CDP_AUDIENCE_LOCALS_KEY] = answer;
      next();
      return;
    }

    res.setHeader('Cache-Control', 'private, no-store');
    if (answer.status === 'unverifiable') {
      res.status(503).json({ code: CDP_COMPANY_ERROR_CODES.ROLE_GRANTS_UNAVAILABLE } satisfies CdpCompanyErrorBody);
      return;
    }
    res.status(404).json({ code: CDP_COMPANY_ERROR_CODES.NOT_FOUND } satisfies CdpCompanyErrorBody);
  } catch (error) {
    next(error);
  }
}

/** The audience answer `requireCdpAudience` stored for this request; `out` when the gate did not run. */
export function cdpAudienceOf(res: Response): CdpAudienceAnswer {
  const answer = res.locals[CDP_AUDIENCE_LOCALS_KEY] as CdpAudienceAnswer | undefined;
  return answer?.status === 'in' ? answer : { status: 'out', lfStaff: false };
}
