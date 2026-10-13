// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CampaignAudiencePlatform, CampaignRefPlatform } from '../interfaces/campaign-optimize.interface';
import { CAMPAIGN_METRICS_WINDOWS, MICROSOFT_KEYWORDS_WINDOWS } from './campaign.constants';

// ---------------------------------------------------------------------------
// Optimize-tab reads and levers proxied to lfx-v2-campaign-service
// ---------------------------------------------------------------------------

/**
 * The reporting windows X accepts for its audience read (`twitterAudienceWindowEnum`,
 * campaign-service `design/brief.go`). X serves segmented stats through asynchronous jobs capped at
 * seven days, so every longer window is refused upstream with a 400.
 */
export const TWITTER_AUDIENCE_WINDOWS = ['today', 'yesterday', 'last_7_days'] as const;

/**
 * The reporting windows the Reddit audience read accepts (`redditAudienceWindowEnum`). The same set
 * as Microsoft's: `yesterday` and `last_14_days` are not available on Reddit.
 */
export const REDDIT_AUDIENCE_WINDOWS = MICROSOFT_KEYWORDS_WINDOWS;

/**
 * Every per-platform audience read the BFF proxies, mapped to the windows that platform's
 * campaign-service read accepts. The keys are campaign-service's own platform path segments.
 *
 * Google Ads is absent on purpose: its audience read is `GET /api/campaigns/audience`, owned by the
 * Insights cutover and not by this table.
 *
 * `linkedin-ads` has NO campaign-service endpoint yet. Its window set is the generic metrics set,
 * a placeholder until upstream publishes one; the route is behind
 * `LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS` until then (see `CAMPAIGN_AUDIENCE_PLATFORMS_PENDING_UPSTREAM`).
 */
export const CAMPAIGN_AUDIENCE_WINDOWS: Readonly<Record<CampaignAudiencePlatform, readonly string[]>> = {
  'meta-ads': CAMPAIGN_METRICS_WINDOWS,
  'twitter-ads': TWITTER_AUDIENCE_WINDOWS,
  'microsoft-ads': MICROSOFT_KEYWORDS_WINDOWS,
  'reddit-ads': REDDIT_AUDIENCE_WINDOWS,
  'linkedin-ads': CAMPAIGN_METRICS_WINDOWS,
};

/**
 * Audience reads whose campaign-service endpoint is not on campaign-service `main` yet: Reddit's is
 * on a feature branch (`get-reddit-ads-audience`), LinkedIn's is not written. The BFF answers 404 for
 * these unless `LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS` is on, so no deployment calls a route upstream
 * does not serve.
 */
export const CAMPAIGN_AUDIENCE_PLATFORMS_PENDING_UPSTREAM: ReadonlySet<CampaignAudiencePlatform> = new Set<CampaignAudiencePlatform>([
  'reddit-ads',
  'linkedin-ads',
]);

/**
 * The id rule each campaign-ref resolve applies to a platform's own campaign id, mirrored from
 * campaign-service's `localCampaignRefMethod` calls (`design/connection.go`). The id is a query
 * parameter upstream, so this refuses early what upstream would refuse with a 400.
 *
 * Google Ads and Microsoft Advertising are absent: their resolves are internal to the keyword
 * actions and have no BFF route. `linkedin-ads` has NO campaign-service endpoint yet; its rule
 * (digits, as LinkedIn campaign ids are numeric) is a placeholder until one is published.
 */
export const CAMPAIGN_REF_ID_PATTERNS: Readonly<Record<CampaignRefPlatform, RegExp>> = {
  'meta-ads': /^[1-9][0-9]{0,31}$/,
  'reddit-ads': /^[A-Za-z0-9_]{1,64}$/,
  'twitter-ads': /^[A-Za-z0-9]{1,64}$/,
  'linkedin-ads': /^[0-9]{1,64}$/,
};

/** Campaign-ref resolves whose campaign-service endpoint is not on `main` yet; 404 unless `LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS` is on. */
export const CAMPAIGN_REF_PLATFORMS_PENDING_UPSTREAM: ReadonlySet<CampaignRefPlatform> = new Set<CampaignRefPlatform>(['linkedin-ads']);

/**
 * The reporting windows the Reddit keyword read accepts. campaign-service has no
 * `GET /projects/{p}/reddit-ads/keywords` yet; the Microsoft keyword read's set is used until it
 * publishes one, and the route is behind `LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS`.
 */
export const REDDIT_KEYWORDS_WINDOWS = MICROSOFT_KEYWORDS_WINDOWS;
