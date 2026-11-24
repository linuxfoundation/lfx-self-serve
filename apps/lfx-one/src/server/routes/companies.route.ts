// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { CdpCompanyController } from '../controllers/cdp-company.controller';
import { requireCdpAudience } from '../middleware/require-cdp-audience.middleware';

/**
 * Spec 062 — CDP companies (`/api/companies`, contracts/bff-cdp-companies.md, contracts/bff-cdp-search.md).
 * `/availability` is the browser's only audience signal and runs outside the gate; every other route runs
 * `requireCdpAudience` first, before the id is parsed. `/search` is declared before `/:cdpId` so it is never
 * taken for an id (it would not match the id format anyway).
 */
const router = Router();
const controller = new CdpCompanyController();

router.get('/availability', (req, res, next) => controller.getAvailability(req, res, next));
router.get('/search', requireCdpAudience, (req, res, next) => controller.search(req, res, next));
router.get('/:cdpId', requireCdpAudience, (req, res, next) => controller.getCompany(req, res, next));
router.get('/:cdpId/sections/:section', requireCdpAudience, (req, res, next) => controller.getSection(req, res, next));

export default router;
