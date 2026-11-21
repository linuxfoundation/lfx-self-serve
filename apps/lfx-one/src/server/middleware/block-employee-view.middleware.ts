// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_LENS_EMPLOYEE_VIEW, ORG_LENS_EMPLOYEE_VIEW_FORBIDDEN_CODE, ORG_LENS_EMPLOYEE_VIEW_FORBIDDEN_MESSAGE } from '@lfx-one/shared/constants';
import type { NextFunction, Request, Response } from 'express';

import { MicroserviceError } from '../errors';
import { resolveOrgLensViewMode } from '../helpers/org-lens-read-access.helper';

const OPERATION = 'block_employee_view';

/**
 * Answers 403 `EMPLOYEE_VIEW_FORBIDDEN` when the caller is in the all employee view of `:orgUid` (epic #5845). Mount it
 * on any route behind a page or side panel the view hides, so the data never leaves the API — hiding it in the UI
 * alone does not count.
 *
 * ```ts
 * router.get('/:orgUid/lens/people', blockEmployeeView, (req, res, next) => controller.getPeople(req, res, next));
 * ```
 *
 * It runs (or replays, the gate is memoized per request) `assertOrgLensRead` itself, so it works wherever it sits
 * relative to `requireOrgLensAccess` and a caller who is refused outright still gets that gate's 403/503, not this
 * one. A grant holder, an auditor-entitled caller and LF staff pass untouched. Roll-up segments pass: the roll-up
 * gate admits grant holders only, and the all employee view never reaches one.
 *
 * Requires an `:orgUid` route param; without one it fails closed rather than guessing.
 */
export async function blockEmployeeView(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const orgUid = req.params['orgUid'];
    if (!orgUid) {
      throw new MicroserviceError('This route cannot tell which company is requested.', 500, 'EMPLOYEE_VIEW_MISCONFIGURED', {
        operation: OPERATION,
        service: 'LFX_V2_SERVICE',
        path: req.path,
      });
    }
    if ((await resolveOrgLensViewMode(req, orgUid, OPERATION)) === ORG_LENS_EMPLOYEE_VIEW) {
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
