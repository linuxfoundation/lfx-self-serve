// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { CampaignController } from '../controllers/campaign.controller';
import { requireExecutiveDirector } from '../middleware/require-executive-director.middleware';

const router = Router();
const campaignController = new CampaignController();

// Campaigns are an ED-only surface client-side (`executiveDirectorGuard` on /foundation/campaigns).
// Every endpoint here is gated the same way server-side — none of this data or these actions
// should be reachable by an authenticated non-ED caller.
router.post('/brief/generate', requireExecutiveDirector, (req, res, next) => campaignController.generateBrief(req, res, next));
router.post('/brief/refine', requireExecutiveDirector, (req, res, next) => campaignController.refineBrief(req, res, next));
router.post('/brief/persist', requireExecutiveDirector, (req, res, next) => campaignController.persistBrief(req, res, next));
router.get('/brief', requireExecutiveDirector, (req, res, next) => campaignController.loadBrief(req, res, next));
router.post('/create', requireExecutiveDirector, (req, res, next) => campaignController.createCampaign(req, res, next));
router.get('/jobs/:jobId', requireExecutiveDirector, (req, res, next) => campaignController.getJobStatus(req, res, next));
// The email channel's template picker. Registered before `/hubspot/utm` only for reading order —
// the paths do not overlap.
router.get('/hubspot/emails', requireExecutiveDirector, (req, res, next) => campaignController.searchHubSpotEmails(req, res, next));
router.get('/hubspot/utm', requireExecutiveDirector, (req, res, next) => campaignController.lookupHubSpotUtm(req, res, next));
router.post('/hubspot/utm/create', requireExecutiveDirector, (req, res, next) => campaignController.createHubSpotUtm(req, res, next));
router.get('/monitor', requireExecutiveDirector, (req, res, next) => campaignController.getMonitorData(req, res, next));
router.get('/linkedin/accounts', requireExecutiveDirector, (req, res) => campaignController.getLinkedInAccounts(req, res));
router.get('/linkedin/monitor', requireExecutiveDirector, (req, res, next) => campaignController.getLinkedInMonitor(req, res, next));
router.get('/reddit/accounts', requireExecutiveDirector, (req, res) => campaignController.getRedditAccounts(req, res));
router.get('/reddit/monitor', requireExecutiveDirector, (req, res, next) => campaignController.getRedditMonitor(req, res, next));
router.get('/meta/accounts', requireExecutiveDirector, (req, res) => campaignController.getMetaAccounts(req, res));
router.get('/meta/monitor', requireExecutiveDirector, (req, res, next) => campaignController.getMetaMonitor(req, res, next));
router.get('/keywords', requireExecutiveDirector, (req, res, next) => campaignController.getKeywords(req, res, next));
router.get('/audience', requireExecutiveDirector, (req, res, next) => campaignController.getAudience(req, res, next));
router.post('/keywords/actions', requireExecutiveDirector, (req, res, next) => campaignController.executeKeywordActions(req, res, next));
router.patch('/:campaignId/status', requireExecutiveDirector, (req, res, next) => campaignController.updateCampaignStatus(req, res, next));

export default router;
