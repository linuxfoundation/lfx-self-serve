// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response, Router } from 'express';

import { FoundationParticipatingOrgsController } from '../controllers/foundation-participating-orgs.controller';
import { ResourceNotFoundError } from '../errors';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { requireDashboardAccess } from '../middleware/require-dashboard-access.middleware';

const router = Router();
const controller = new FoundationParticipatingOrgsController();

// Foundation Lens → Participating Companies (#5697). Executive director of the foundation, or LF staff — the same
// policy as the Health Metrics endpoints (`dashboardAccessGuard` in the browser). The foundation travels as `?foundationSlug=`.
// Dark launch (#5707): the data is a fictional demo set until the warehouse model exists, so with the flag off every
// request gets the same neutral 404, before any access check can tell a caller anything.
function requireFoundationParticipatingOrgsEnabled(_req: Request, _res: Response, next: NextFunction): void {
  if (!isServerFeatureEnabled(ServerFeatureFlag.FoundationParticipatingOrgs)) {
    next(new ResourceNotFoundError('Resource', undefined, { operation: 'foundation_participating_orgs_flag_off' }));
    return;
  }
  next();
}

router.use(requireFoundationParticipatingOrgsEnabled, requireDashboardAccess);

router.get('/projects', (req, res, next) => controller.getProjects(req, res, next));
router.get('/summary', (req, res, next) => controller.getSummary(req, res, next));
router.get('/breakdown', (req, res, next) => controller.getBreakdown(req, res, next));
router.get('/export', (req, res, next) => controller.export(req, res, next));
router.get('/', (req, res, next) => controller.getList(req, res, next));

export default router;
