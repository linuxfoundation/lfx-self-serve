// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { CampaignController } from '../controllers/campaign.controller';
import { requireProjectAccess } from '../middleware/require-project-access.middleware';

const router = Router();
const campaignController = new CampaignController();

// Campaign access enforcement — gated by FGA relation on the selected foundation.
// See LFXV2-2235. Enforcement is flag-gated (MARKETING_ACCESS_ENFORCEMENT=true).
// All routes require foundationSlug (sent by campaign.service.ts via LFXV2-2235).
//
// FGA model 14.1.0 (LFXV2-1760): both campaign_viewer and campaign_manager
// resolve to `executive_director or marketing_ops`, so every campaign_manager
// user also holds campaign_viewer. The viewer/manager split is semantic
// (future-proofing) and does not create a case where a manager can create but
// not poll. If the FGA model changes, revisit this split.
const requireCampaignViewer = requireProjectAccess('campaign_viewer');
const requireCampaignManager = requireProjectAccess('campaign_manager');

// Write operations — require campaign_manager
router.post('/brief/generate', requireCampaignManager, (req, res, next) => campaignController.generateBrief(req, res, next));
router.post('/brief/refine', requireCampaignManager, (req, res, next) => campaignController.refineBrief(req, res, next));
router.post('/create', requireCampaignManager, (req, res, next) => campaignController.createCampaign(req, res, next));
router.post('/hubspot/utm/create', requireCampaignManager, (req, res, next) => campaignController.createHubSpotUtm(req, res, next));
router.post('/keywords/actions', requireCampaignManager, (req, res, next) => campaignController.executeKeywordActions(req, res, next));
router.patch('/:campaignId/status', requireCampaignManager, (req, res, next) => campaignController.updateCampaignStatus(req, res, next));

// Read operations — require campaign_viewer
router.get('/jobs/:jobId', requireCampaignViewer, (req, res, next) => campaignController.getJobStatus(req, res, next));
router.get('/hubspot/utm', requireCampaignViewer, (req, res, next) => campaignController.lookupHubSpotUtm(req, res, next));
router.get('/monitor', requireCampaignViewer, (req, res, next) => campaignController.getMonitorData(req, res, next));
router.get('/linkedin/accounts', requireCampaignViewer, (req, res) => campaignController.getLinkedInAccounts(req, res));
router.get('/linkedin/monitor', requireCampaignViewer, (req, res, next) => campaignController.getLinkedInMonitor(req, res, next));
router.get('/reddit/accounts', requireCampaignViewer, (req, res) => campaignController.getRedditAccounts(req, res));
router.get('/reddit/monitor', requireCampaignViewer, (req, res, next) => campaignController.getRedditMonitor(req, res, next));
router.get('/meta/accounts', requireCampaignViewer, (req, res) => campaignController.getMetaAccounts(req, res));
router.get('/meta/monitor', requireCampaignViewer, (req, res, next) => campaignController.getMetaMonitor(req, res, next));
router.get('/keywords', requireCampaignViewer, (req, res, next) => campaignController.getKeywords(req, res, next));
router.get('/audience', requireCampaignViewer, (req, res, next) => campaignController.getAudience(req, res, next));

export default router;
