// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ORG_LENS_EMPLOYEE_VIEW,
  ORG_LENS_EMPLOYEE_VIEW_FORBIDDEN_CODE,
  ORG_LENS_EMPLOYEE_VIEW_FORBIDDEN_MESSAGE,
  PD_EMPLOYEE_VIEW_TECHNICAL_CARD_KEYS,
} from '@lfx-one/shared/constants';
import type { NextFunction, Request, Response } from 'express';

import { MicroserviceError } from '../errors';
import { resolveOrgLensViewMode } from '../helpers/org-lens-read-access.helper';

const OPERATION = 'block_employee_view_ecosystem_card';

/**
 * Project detail card panels in the all employee view (epic #5845, #5849): only the Technical Influence cards
 * (`PD_EMPLOYEE_VIEW_TECHNICAL_CARD_KEYS`, public GitHub data) may open. Every other card key answers 403, so the
 * Ecosystem Influence section is blocked as a whole and a card added later is blocked by default. Mount on the
 * `/cards/:cardKey` routes. The full view and LF staff pass untouched.
 */
export async function blockEmployeeViewEcosystemCard(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const orgUid = req.params['orgUid'];
    const cardKey = req.params['cardKey'];
    if (!orgUid) {
      throw new MicroserviceError('This route cannot tell which company is requested.', 500, 'EMPLOYEE_VIEW_MISCONFIGURED', {
        operation: OPERATION,
        service: 'LFX_V2_SERVICE',
        path: req.path,
      });
    }
    if ((await resolveOrgLensViewMode(req, orgUid, OPERATION)) === ORG_LENS_EMPLOYEE_VIEW && !(cardKey && PD_EMPLOYEE_VIEW_TECHNICAL_CARD_KEYS.has(cardKey))) {
      throw new MicroserviceError(ORG_LENS_EMPLOYEE_VIEW_FORBIDDEN_MESSAGE, 403, ORG_LENS_EMPLOYEE_VIEW_FORBIDDEN_CODE, {
        operation: OPERATION,
        service: 'LFX_V2_SERVICE',
        path: req.path,
      });
    }
    next();
  } catch (error) {
    next(error);
  }
}
