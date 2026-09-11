// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { AudienceBuilderController } from '../controllers/audience-builder.controller';
import { CampaignController } from '../controllers/campaign.controller';
import { requireCampaignManager } from '../middleware/require-marketing-access.middleware';

const router = Router();
const campaignController = new CampaignController();
const audienceBuilderController = new AudienceBuilderController();

// Marketing-ops gated (LFXV2-2235): every Campaigns endpoint, reads and writes, previously had
// no authorization middleware at all. `requireCampaignManager` falls back to ED-only while its
// server flag is off — this is an intentional tightening of the prior (fully open) behavior, not
// a preserved no-op: with the flag off, a previously-unauthenticated-relative-to-Campaigns caller
// now gets a 403 unless they hold the ED persona. The "kill switch" restores the FGA-off baseline
// (ED-only), not the pre-PR baseline (no auth at all) — reverting to the latter would reopen the
// hole this route.use() closes.
router.use(requireCampaignManager);

router.post('/brief/generate', (req, res, next) => campaignController.generateBrief(req, res, next));
router.post('/brief/refine', (req, res, next) => campaignController.refineBrief(req, res, next));
router.post('/brief/persist', (req, res, next) => campaignController.persistBrief(req, res, next));
router.get('/brief', (req, res, next) => campaignController.loadBrief(req, res, next));
// campaign-service's OWN metrics and action items for one brief. Distinct from `/monitor` and its
// per-platform siblings below, which read the ad platforms directly and derive action items from
// four separate rule engines in this BFF. Brief-scoped where those are account-scoped, so it is
// not a drop-in replacement for them; nothing is cut over to it yet.
router.get('/brief/metrics', (req, res, next) => campaignController.getBriefMetrics(req, res, next));
router.post('/create', (req, res, next) => campaignController.createCampaign(req, res, next));
router.get('/list', (req, res, next) => campaignController.listBriefCampaigns(req, res, next));
router.get('/jobs/:jobId', (req, res, next) => campaignController.getJobStatus(req, res, next));
// The email channel's template picker. Registered before `/hubspot/utm` only for reading order —
// the paths do not overlap.
router.get('/hubspot/emails', (req, res, next) => campaignController.searchHubSpotEmails(req, res, next));
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
router.post('/audience/build', (req, res, next) => campaignController.buildAudience(req, res, next));
router.post('/email-copy', (req, res, next) => campaignController.generateEmailCopy(req, res, next));
router.get('/audience', (req, res, next) => campaignController.getAudience(req, res, next));
router.post('/keywords/actions', (req, res, next) => campaignController.executeKeywordActions(req, res, next));
router.patch('/:campaignId/status', (req, res, next) => campaignController.updateCampaignStatus(req, res, next));

// --- Audience Builder ------------------------------------------------------
//
// Authorization is the `requireCampaignManager` above, which covers these routes with the rest.
// `/capabilities` reports whether HubSpot is reachable, so the client can render the tab in its
// degraded, HubSpot-unconfigured form rather than letting every action fail with an opaque 500.
//
// `compose-master` creates real contact lists in the production HubSpot portal, and nothing here
// gates that beyond the campaign-manager check — the caller's authorization IS the control.
router.get('/audience-builder/capabilities', (req, res, next) => audienceBuilderController.getCapabilities(req, res, next));
router.post('/audience-builder/discover', (req, res, next) => audienceBuilderController.discover(req, res, next));
router.get('/audience-builder/lists/search', (req, res, next) => audienceBuilderController.searchLists(req, res, next));
router.get('/audience-builder/suppression-lists', (req, res, next) => audienceBuilderController.getSuppressionLists(req, res, next));
router.get('/audience-builder/last-sent', (req, res, next) => audienceBuilderController.getLastSent(req, res, next));
router.get('/audience-builder/existing-master-lists', (req, res, next) => audienceBuilderController.getExistingMasterLists(req, res, next));
router.post('/audience-builder/preview-count', (req, res, next) => audienceBuilderController.previewCount(req, res, next));
router.post('/audience-builder/compose-master', (req, res, next) => audienceBuilderController.composeMaster(req, res, next));
router.post('/audience-builder/qa/run', (req, res, next) => audienceBuilderController.runQa(req, res, next));

export default router;
