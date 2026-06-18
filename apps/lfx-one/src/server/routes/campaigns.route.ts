// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { CampaignController } from '../controllers/campaign.controller';

const router = Router();
const campaignController = new CampaignController();

router.post('/brief/generate', (req, res, next) => campaignController.generateBrief(req, res, next));
router.post('/brief/refine', (req, res, next) => campaignController.refineBrief(req, res, next));
router.post('/create', (req, res, next) => campaignController.createCampaign(req, res, next));
router.get('/jobs/:jobId', (req, res, next) => campaignController.getJobStatus(req, res, next));
router.get('/hubspot/utm', (req, res, next) => campaignController.lookupHubSpotUtm(req, res, next));
router.post('/hubspot/utm/create', (req, res, next) => campaignController.createHubSpotUtm(req, res, next));
router.get('/monitor', (req, res, next) => campaignController.getMonitorData(req, res, next));
router.get('/linkedin/accounts', (req, res) => campaignController.getLinkedInAccounts(req, res));
router.get('/linkedin/monitor', (req, res, next) => campaignController.getLinkedInMonitor(req, res, next));
router.get('/reddit/accounts', (req, res) => campaignController.getRedditAccounts(req, res));
router.get('/reddit/monitor', (req, res, next) => campaignController.getRedditMonitor(req, res, next));
router.get('/meta/accounts', (req, res) => campaignController.getMetaAccounts(req, res));
router.get('/meta/monitor', (req, res, next) => campaignController.getMetaMonitor(req, res, next));
router.get('/keywords', (req, res, next) => campaignController.getKeywords(req, res, next));
router.get('/audience', (req, res, next) => campaignController.getAudience(req, res, next));
router.post('/keywords/actions', (req, res, next) => campaignController.executeKeywordActions(req, res, next));

export default router;
