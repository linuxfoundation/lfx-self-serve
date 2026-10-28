// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CREATIVE_ASSET_MAX_BYTES, CREATIVE_ASSET_MIME_TYPES, CREATIVE_ASSET_TOO_LARGE_MESSAGE } from '@lfx-one/shared/constants';
import express, { NextFunction, Request, Response, Router } from 'express';

import { AudienceBuilderController } from '../controllers/audience-builder.controller';
import { CampaignController } from '../controllers/campaign.controller';
import { CampaignOptimizeController } from '../controllers/campaign-optimize.controller';
import { MicroserviceError } from '../errors';
import { requireCampaignManager, requireGoogleMonitorAccess } from '../middleware/require-marketing-access.middleware';

/**
 * Converts the raw body parser's size-limit error (`entity.too.large`) into a 413 before it
 * reaches the global error handler, which keeps the real status only for BaseApiError instances
 * and would otherwise flatten it into a 500. Mirrors `mentorship-mentee.route.ts`.
 */
function handleCreativeAssetParseError(err: unknown, req: Request, _res: Response, next: NextFunction): void {
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
    next(
      new MicroserviceError(CREATIVE_ASSET_TOO_LARGE_MESSAGE, 413, 'PAYLOAD_TOO_LARGE', {
        operation: 'campaign_upload_creative_asset',
        service: 'campaign_controller',
        path: req.path,
      })
    );
    return;
  }
  // Every other body-parser refusal (an aborted upload, an unsupported Content-Encoding, a size
  // that disagrees with Content-Length) is the client's, and keeps its 4xx rather than becoming a 500.
  const status = err && typeof err === 'object' ? (err as { status?: unknown }).status : undefined;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    next(
      new MicroserviceError('The image upload could not be read. Please try again.', status, status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'BAD_REQUEST', {
        operation: 'campaign_upload_creative_asset',
        service: 'campaign_controller',
        path: req.path,
      })
    );
    return;
  }
  next(err);
}

const router = Router();
const campaignController = new CampaignController();
const audienceBuilderController = new AudienceBuilderController();
const optimizeController = new CampaignOptimizeController();

// Google Ads account monitor: requires `?project=`, but reads the shared account, not that project's
// data. Its route-specific guard admits ROOT callers without granting access to project writes.
router.get('/monitor', requireGoogleMonitorAccess, (req, res, next) => campaignController.getMonitorData(req, res, next));

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
// Approves a brief that is already stored, and writes nothing to it. Two path segments after
// `/brief`, so it cannot collide with the single-segment `/brief/persist` or `/brief/metrics`
// routes, whichever order they are registered in. Empty body: the
// brief is the path, the foundation is `?project=`, and the validator is the request's `If-Match`.
router.post('/brief/:briefId/approve', (req, res, next) => campaignController.approveBrief(req, res, next));
// campaign-service's OWN metrics and action items for one brief. Distinct from `/monitor` and its
// per-platform siblings below, which read the ad platforms directly and derive action items from
// four separate rule engines in this BFF. Brief-scoped where those are account-scoped, so it is
// not a drop-in replacement for them; nothing is cut over to it yet. Because the Google, Meta,
// Reddit and X accounts are shared by every foundation, those account monitors (and LinkedIn's
// legacy arm) are root-only in the controller (lfx-self-serve-ops#54).
router.get('/brief/metrics', (req, res, next) => campaignController.getBriefMetrics(req, res, next));
router.post('/create', (req, res, next) => campaignController.createCampaign(req, res, next));
// An image for the brief, stored by campaign-service and named by asset id in a platform's
// creative config — `redditConfig.imageAssetId` (decision D3), and the Google creative fields. The
// body is the raw PNG/JPEG bytes, buffered here (at most CREATIVE_ASSET_MAX_BYTES) so the upstream
// JSON body can be sent with a declared Content-Length.
router.post(
  '/brief/creative-assets',
  express.raw({ type: [...CREATIVE_ASSET_MIME_TYPES], limit: CREATIVE_ASSET_MAX_BYTES }),
  handleCreativeAssetParseError,
  (req: Request, res: Response, next: NextFunction) => campaignController.uploadCreativeAsset(req, res, next)
);
// Reads and pruning of that same library. Unlike the upload they are gated on
// LFX_CUTOVER_CAMPAIGN_SERVICE_BRIEFS alone, not on either creative-asset capability flag: they are
// addressed by a campaign-service brief, and a deployment must be able to see and prune what it
// already stores whatever platform may currently consume it.
router.get('/brief/creative-assets', (req, res, next) => campaignController.listCreativeAssets(req, res, next));
// BEFORE the `:assetId` route below: Express matches in registration order, so a `plan` registered
// after it would be swallowed as an asset id. The handler also refuses an `:assetId` that is not a
// UUID, so reordering this fails loudly instead of silently reading `plan` as an id.
router.get('/brief/creative-assets/plan', (req, res, next) => campaignController.getCreativeAssetPlan(req, res, next));
router.get('/brief/creative-assets/:assetId', (req, res, next) => campaignController.getCreativeAsset(req, res, next));
router.delete('/brief/creative-assets/:assetId', (req, res, next) => campaignController.deleteCreativeAsset(req, res, next));
router.get('/list', (req, res, next) => campaignController.listBriefCampaigns(req, res, next));
router.get('/jobs/:jobId', (req, res, next) => campaignController.getJobStatus(req, res, next));
// The email channel's template picker. Registered before `/hubspot/utm` only for reading order —
// the paths do not overlap.
router.get('/hubspot/emails', (req, res, next) => campaignController.searchHubSpotEmails(req, res, next));
router.get('/hubspot/utm', (req, res, next) => campaignController.lookupHubSpotUtm(req, res, next));
router.post('/hubspot/utm/create', (req, res, next) => campaignController.createHubSpotUtm(req, res, next));
// Which account each LinkedIn/Reddit/Meta/Microsoft/X Monitor panel offers: the project's OWN
// connection's (#2519). `viaCampaignService: false` while LFX_CUTOVER_CAMPAIGN_SERVICE_MONITOR is off.
router.get('/monitor/connections', (req, res, next) => campaignController.getMonitorConnections(req, res, next));
router.get('/linkedin/accounts', (req, res) => campaignController.getLinkedInAccounts(req, res));
router.get('/linkedin/monitor', (req, res, next) => campaignController.getLinkedInMonitor(req, res, next));
router.get('/reddit/accounts', (req, res) => campaignController.getRedditAccounts(req, res));
router.get('/reddit/monitor', (req, res, next) => campaignController.getRedditMonitor(req, res, next));
router.get('/meta/accounts', (req, res) => campaignController.getMetaAccounts(req, res));
router.get('/meta/monitor', (req, res, next) => campaignController.getMetaMonitor(req, res, next));
// campaign-service account discovery for the project's Google Ads connection, behind
// LFX_CUTOVER_CAMPAIGN_SERVICE_MONITOR — 404 while it is off. Root-only, as the Google Ads monitor is.
router.get('/google/accounts', (req, res, next) => campaignController.getGoogleAdsAccounts(req, res, next));
// campaign-service only (#2519), behind LFX_CUTOVER_CAMPAIGN_SERVICE_MONITOR — 404 while it is off.
// Microsoft and X take the platform account id as `?accountKey=`; HubSpot is project-scoped and takes none.
router.get('/microsoft/monitor', (req, res, next) => campaignController.getMicrosoftMonitor(req, res, next));
router.get('/twitter/monitor', (req, res, next) => campaignController.getTwitterMonitor(req, res, next));
router.get('/hubspot/monitor', (req, res, next) => campaignController.getHubSpotMonitor(req, res, next));
router.get('/keywords', (req, res, next) => campaignController.getKeywords(req, res, next));
// campaign-service only, from its saved Microsoft keyword reports: takes `?window=`, not `?days=`.
router.get('/microsoft/keywords', (req, res, next) => campaignController.getMicrosoftKeywords(req, res, next));
router.post('/email-copy', (req, res, next) => campaignController.generateEmailCopy(req, res, next));
router.get('/audience', (req, res, next) => campaignController.getAudience(req, res, next));
// PLURAL, and not by accident: `/audience` above is the paid-channel demographics read, which has
// nothing to do with a brief's HubSpot audience rows. Reusing that path would have made the two
// collide on method AND path.
router.get('/audiences', (req, res, next) => campaignController.listAudiences(req, res, next));
router.post('/keywords/actions', (req, res, next) => campaignController.executeKeywordActions(req, res, next));
router.patch('/:campaignId/status', (req, res, next) => campaignController.updateCampaignStatus(req, res, next));
// campaign-service only: the id must be a campaign-service UUID. Amount in the ad account's own currency.
router.patch('/:campaignId/budget', (req, res, next) => campaignController.updateCampaignBudget(req, res, next));
// campaign-service only, like the budget change. Manual max CPC bid, in the ad account's own currency.
router.patch('/:campaignId/bid', (req, res, next) => campaignController.updateCampaignBid(req, res, next));
// campaign-service only: Google Ads, Microsoft Advertising, Reddit and X. Positional response: results[i] answers
// negativeKeywords[i]. Reddit requires the keyword-targeting read's `revision`; the others refuse it.
router.post('/:campaignId/negative-keywords', (req, res, next) => campaignController.addNegativeKeywords(req, res, next));
// One campaign's live counters (`get-campaign-metrics`): the Optimize tab's per-row Refresh, and the
// precise reason for a row the brief-wide read could not measure. Takes `?project=&briefId=` and an
// optional `?window=`. Behind LFX_CUTOVER_CAMPAIGN_SERVICE_BRIEFS — 404 while it is off.
// Order is safe because the only fixed `/<segment>/metrics` GET, `/brief/metrics`, is registered ABOVE
// and so matches first; no fixed `/x/metrics` GET is registered after this one for it to shadow.
router.get('/:campaignId/metrics', (req, res, next) => campaignController.getCampaignMetrics(req, res, next));

// --- Optimize: campaign-service reads and levers ------------------------------
//
// campaign-service only, no legacy arm, so ungated like the budget and bid levers above, EXCEPT
// a read whose upstream endpoint is not served yet. None is pending today (both PENDING_UPSTREAM sets
// are empty); such a read answers 404 unless LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS is on.
// Authorization is the `requireCampaignManager` above. Campaign and brief ids are campaign-service UUIDs.
router.get('/meta/audience', (req, res, next) => optimizeController.getPlatformAudience(req, res, next, 'meta-ads'));
router.get('/twitter/audience', (req, res, next) => optimizeController.getPlatformAudience(req, res, next, 'twitter-ads'));
router.get('/microsoft/audience', (req, res, next) => optimizeController.getPlatformAudience(req, res, next, 'microsoft-ads'));
router.get('/reddit/audience', (req, res, next) => optimizeController.getPlatformAudience(req, res, next, 'reddit-ads'));
router.get('/linkedin/audience', (req, res, next) => optimizeController.getPlatformAudience(req, res, next, 'linkedin-ads'));
// Platform campaign id -> campaign-service campaign + brief. More than one match is reachable: refuse, never choose.
router.get('/meta/campaign-ref', (req, res, next) => optimizeController.resolvePlatformCampaign(req, res, next, 'meta-ads'));
router.get('/reddit/campaign-ref', (req, res, next) => optimizeController.resolvePlatformCampaign(req, res, next, 'reddit-ads'));
router.get('/twitter/campaign-ref', (req, res, next) => optimizeController.resolvePlatformCampaign(req, res, next, 'twitter-ads'));
router.get('/linkedin/campaign-ref', (req, res, next) => optimizeController.resolvePlatformCampaign(req, res, next, 'linkedin-ads'));
router.get('/microsoft/campaign-ref', (req, res, next) => optimizeController.resolvePlatformCampaign(req, res, next, 'microsoft-ads'));
// Reddit keyword performance, read-only (campaign-service #331). Takes `?window=` like the Microsoft keyword read.
router.get('/reddit/keywords', (req, res, next) => optimizeController.getRedditKeywords(req, res, next));
// Binds a campaign that already exists on its platform to a brief; creates nothing upstream.
router.post('/adopt', (req, res, next) => optimizeController.adoptCampaign(req, res, next));
// The approved paid briefs a campaign can be adopted into (Query Service). 404 unless campaign-service briefs are on.
router.get('/briefs', (req, res, next) => optimizeController.listAdoptableBriefs(req, res, next));
// The campaign row from campaign-service (not the index) with its current ETag. Two callers: the Optimize tab,
// to recover a row's ETag after an ad-set write whose outcome left the validator unknown, and the
// act-from-Monitor dialog, for its levers' If-Match.
router.get('/:campaignId/record', (req, res, next) => optimizeController.getCampaignRecord(req, res, next));
router.get('/:campaignId/settings', (req, res, next) => optimizeController.getCampaignSettings(req, res, next));
router.get('/:campaignId/meta-ad-sets', (req, res, next) => optimizeController.listMetaAdSets(req, res, next));
// Read-only: there is no per-ad lever. `truncated` in the answer says Meta's ad listing passed its page cap.
router.get('/:campaignId/meta-ad-sets/:adSetId/ads', (req, res, next) => optimizeController.listMetaAds(req, res, next));
// If-Match from the body's etag. A 503 that may have reached Meta answers code META_AD_SET_STATUS_UNCONFIRMED.
router.post('/:campaignId/meta-ad-sets/:adSetId/status', (req, res, next) => optimizeController.updateMetaAdSetStatus(req, res, next));
router.get('/:campaignId/keyword-targeting', (req, res, next) => optimizeController.getKeywordTargeting(req, res, next));
// Positional response: results[i] answers keywords[i]. Reddit requires the read's revision.
router.post('/:campaignId/keyword-targeting/removals', (req, res, next) => optimizeController.removeKeywordTargeting(req, res, next));

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
// `attach-existing` creates nothing in HubSpot: it records lists that already exist (an earlier
// send's selection, or a master built before) as the brief's send audience.
router.post('/audience-builder/attach-existing', (req, res, next) => audienceBuilderController.attachExisting(req, res, next));
router.post('/audience-builder/qa/run', (req, res, next) => audienceBuilderController.runQa(req, res, next));
router.post('/audience-builder/custom/interpret', (req, res, next) => audienceBuilderController.interpretCustom(req, res, next));
router.post('/audience-builder/custom/preview', (req, res, next) => audienceBuilderController.previewCustom(req, res, next));
router.post('/audience-builder/custom/create', (req, res, next) => audienceBuilderController.createCustom(req, res, next));

export default router;
