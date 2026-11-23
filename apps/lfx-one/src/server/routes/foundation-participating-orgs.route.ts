// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { FoundationParticipatingOrgsController } from '../controllers/foundation-participating-orgs.controller';
import { requireDashboardAccess } from '../middleware/require-dashboard-access.middleware';

const router = Router();
const controller = new FoundationParticipatingOrgsController();

// Foundation Lens → Participating Companies (#5697). Executive director of the foundation, or LF staff — the same
// policy as the Health Metrics endpoints (`dashboardAccessGuard` in the browser). The foundation travels as `?foundationSlug=`.
router.use(requireDashboardAccess);

router.get('/projects', (req, res, next) => controller.getProjects(req, res, next));
router.get('/summary', (req, res, next) => controller.getSummary(req, res, next));
router.get('/breakdown', (req, res, next) => controller.getBreakdown(req, res, next));
router.get('/export', (req, res, next) => controller.export(req, res, next));
router.get('/', (req, res, next) => controller.getList(req, res, next));

export default router;
