// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_BOOST_POST_FIELD, LINKEDIN_BOOST_POST_URN_PATTERN } from '../constants/campaign.constants';
import type { LinkedInConfigKeyRefusal } from '../interfaces/campaign.interface';

/**
 * Boosting an existing LinkedIn organization post (linuxfoundation/lfx-v2-campaign-service#673), mirroring
 * campaign-service's checks (`linkedinFormat` in `internal/dispatch/linkedin_text_ads.go`, `linkedinBoostFormat` in
 * `linkedin_boost.go`, `ValidateBoostPostURN` in `internal/platform/linkedin/boost.go`), so a create campaign-service would
 * refuse is refused here first, with a field to point at. Whether the post can be sponsored (its author, visibility and
 * content) is campaign-service's alone to judge, since only it reads the post.
 */

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Why `raw`'s boost fields cannot be sent, or `null` (campaign-service#673). Typed runtime checks, since the create route
 * has no body validator. A create names a boost with `format: "boost"`, or with a `boostPost` other than `""`
 * (campaign-service reads `""` as omitted). With neither, nothing is checked. Refused, in campaign-service's order:
 *
 * - either while this deployment cannot send them (`enabled`): refused, never dropped, since the legacy creator would
 *   make a single-image campaign instead and campaign-service refuses them while `LINKEDIN_ADS_BOOST_POST_ENABLED` is off;
 * - a `boostPost` that is not text (`null` included);
 * - a `boostPost` without `format: "boost"`;
 * - a boost with `textAds` (any key, `null` included) or with `variants`: the post is the one creative;
 * - no `boostPost`, or one that is not exactly `urn:li:share:<id>` or `urn:li:ugcPost:<id>`.
 *
 * Messages never echo a caller value.
 */
export function linkedInBoostRefusal(raw: unknown, enabled: boolean): LinkedInConfigKeyRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  const boost = config['format'] === 'boost';
  const present = 'boostPost' in config && config['boostPost'] !== '';
  if (!boost && !present) return null;
  if (!enabled) {
    return {
      field: boost ? 'linkedInConfig.format' : LINKEDIN_BOOST_POST_FIELD,
      message: 'This deployment cannot boost LinkedIn posts. Choose single image ads to create the campaign.',
    };
  }
  if (present && typeof config['boostPost'] !== 'string') return { field: LINKEDIN_BOOST_POST_FIELD, message: 'Send it as text.' };
  if (!boost) return { field: LINKEDIN_BOOST_POST_FIELD, message: 'The post to boost goes only with the boost format.' };
  if ('textAds' in config) return { field: 'linkedInConfig.textAds', message: 'Text ads go only with the text ad format.' };
  const variants = config['variants'];
  if (Array.isArray(variants) && variants.length > 0) {
    return { field: 'linkedInConfig.variants', message: 'A boost sponsors an existing post. Send no single image or video ads.' };
  }
  const post = typeof config['boostPost'] === 'string' ? config['boostPost'] : '';
  if (post === '') return { field: LINKEDIN_BOOST_POST_FIELD, message: 'Choose the LinkedIn post to boost.' };
  if (!LINKEDIN_BOOST_POST_URN_PATTERN.test(post)) {
    return { field: LINKEDIN_BOOST_POST_FIELD, message: 'The post must be a LinkedIn post URN, urn:li:share:<id> or urn:li:ugcPost:<id>.' };
  }
  return null;
}
