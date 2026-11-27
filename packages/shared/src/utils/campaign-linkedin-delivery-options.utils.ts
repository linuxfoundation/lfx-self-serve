// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_AUDIENCE_EXPANSION_FIELD, LINKEDIN_OFFSITE_DELIVERY_FIELD } from '../constants/campaign.constants';
import type { LinkedInConfigKeyRefusal } from '../interfaces/campaign.interface';

/**
 * LinkedIn Audience Expansion and the LinkedIn Audience Network (linuxfoundation/lfx-v2-campaign-service#667), mirroring
 * campaign-service's checks (`checkDeliveryOptionsShape` and `linkedinDeliveryOptions` in
 * `internal/dispatch/linkedin_delivery_options.go`, `ValidateDeliveryOptions` in
 * `internal/platform/linkedin/delivery_options.go`), so a create campaign-service would refuse is refused here first, with
 * a field to point at. The lead generation objective's own refusal of the Audience Network is `linkedInLeadGenRefusal`'s.
 */

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The two options as `linkedInConfig` spells them, each with the field its refusal names, in campaign-service's order. */
const DELIVERY_OPTION_FIELDS = [
  ['audienceExpansionEnabled', LINKEDIN_AUDIENCE_EXPANSION_FIELD],
  ['offsiteDeliveryEnabled', LINKEDIN_OFFSITE_DELIVERY_FIELD],
] as const;

/**
 * Why `raw`'s `audienceExpansionEnabled` or `offsiteDeliveryEnabled` cannot be sent, or `null` (#667). Typed runtime
 * checks, since the create route has no body validator. An option counts as set when present and not `null` (campaign-
 * service reads `null` as omitted), `false` included. With neither set, nothing is checked. Refused, in campaign-service's
 * order:
 *
 * - a value that is not a boolean;
 * - either while this deployment cannot send them (`enabled`): refused, never dropped, since the legacy creator ignores
 *   them and campaign-service refuses them while its own `LINKEDIN_ADS_DELIVERY_OPTIONS_ENABLED` is off;
 * - `offsiteDeliveryEnabled: true` with `format: "text"`: the Audience Network serves Sponsored Content only.
 *
 * Messages never echo a caller value.
 */
export function linkedInDeliveryOptionsRefusal(raw: unknown, enabled: boolean): LinkedInConfigKeyRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  const set = DELIVERY_OPTION_FIELDS.filter(([key]) => key in config && config[key] !== null);
  if (set.length === 0) return null;
  const notBoolean = set.find(([key]) => typeof config[key] !== 'boolean');
  if (notBoolean) return { field: notBoolean[1], message: 'Send it as true or false.' };
  if (!enabled) {
    return {
      field: set[0][1],
      message: 'This deployment cannot set LinkedIn Audience Expansion or the Audience Network. Remove them to create the campaign.',
    };
  }
  if (config['offsiteDeliveryEnabled'] === true && config['format'] === 'text') {
    return { field: LINKEDIN_OFFSITE_DELIVERY_FIELD, message: 'The LinkedIn Audience Network serves Sponsored Content only, not text ads. Turn it off.' };
  }
  return null;
}
