// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  LINKEDIN_CONVERSIONS_FIELD,
  LINKEDIN_LEAD_GEN_OBJECTIVE,
  LINKEDIN_MAX_CONVERSIONS,
  LINKEDIN_OBJECTIVE_FIELD,
  LINKEDIN_OBJECTIVES,
} from '../constants/campaign.constants';
import type { LinkedInConfigKeyRefusal, LinkedInConversionRule } from '../interfaces/campaign.interface';

/**
 * LinkedIn objective and conversions (#5764 rows 2 and 4), mirroring campaign-service's checks (`checkConversionsShape`,
 * `linkedinConversions`, `checkObjectiveShape` and `linkedinObjective` in `internal/dispatch/linkedin.go`,
 * `ValidateConversions` in `internal/platform/linkedin/conversions.go`, #552, #582), so a create campaign-service would
 * refuse is refused here first, with a field to point at.
 */

/** The largest LinkedIn `long`: a conversion rule id is a positive int64. */
const MAX_LONG = BigInt('9223372036854775807');
const LONG_ID_PATTERN = /^[1-9][0-9]{0,18}$/;

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Whether `id` is a LinkedIn `long` id: digits, no leading zero, positive and within int64 (campaign-service's
 * `isPositiveLong`). Conversion rule ids and Lead Gen Form ids are both held to it.
 */
export function isLinkedInLongId(id: string): boolean {
  return LONG_ID_PATTERN.test(id) && BigInt(id) <= MAX_LONG;
}

const isConversionRuleId = isLinkedInLongId;

/** `record` without `key`. */
function withoutKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

/** Why `conversions` cannot be sent, or `null`: campaign-service's `ValidateConversions`, distinct ids counted. */
function conversionsRefusal(conversions: string[]): LinkedInConfigKeyRefusal | null {
  const field = LINKEDIN_CONVERSIONS_FIELD;
  if (conversions.length === 0) return { field, message: 'Conversions is empty. Pick a conversion rule or remove the field.' };
  const tooMany = { field, message: `At most ${LINKEDIN_MAX_CONVERSIONS} conversion rules can be tracked.` };
  if (conversions.length > 2 * LINKEDIN_MAX_CONVERSIONS) return tooMany;
  const seen = new Set<string>();
  for (const id of conversions) {
    if (!isConversionRuleId(id)) {
      if (id.startsWith('urn:')) return { field, message: 'Send each conversion rule by its numeric id, not its URN.' };
      return { field, message: 'A conversion rule id must be a positive whole number without a leading zero.' };
    }
    seen.add(id);
    if (seen.size > LINKEDIN_MAX_CONVERSIONS) return tooMany;
  }
  return null;
}

/**
 * Why `raw`'s `objective` or `conversions` cannot be sent, or `null` (#5764 rows 2 and 4). Typed runtime checks, since
 * the create route has no body validator. Absent both, nothing is checked, and the `lead_generation` objective counts as
 * absent: it is `linkedInLeadGenRefusal`'s. Refused:
 *
 * - a `conversions` that is not a list of text (`null` included), or an `objective` that is not non-empty text;
 * - either field while this deployment cannot send them (`enabled`): refused, never dropped, since the legacy creator
 *   ignores both and campaign-service refuses `conversions` while `LINKEDIN_ADS_CONVERSIONS_ENABLED` is off;
 * - an empty `conversions`, more than twice `LINKEDIN_MAX_CONVERSIONS` entries, an id that is a URN or not a positive
 *   int64 without a leading zero, or more than `LINKEDIN_MAX_CONVERSIONS` distinct ids;
 * - an `objective` other than `LINKEDIN_OBJECTIVES`, spelled exactly; `traffic` with a manual bid (a manual bid is
 *   created under Website conversions); `conversions` on automatic bidding with no `conversions`, since LinkedIn will
 *   not activate a Maximum delivery conversions campaign until a conversion rule is associated.
 *
 * Messages never echo a caller value.
 */
export function linkedInObjectiveRefusal(raw: unknown, enabled: boolean): LinkedInConfigKeyRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  // The lead generation objective has its own flag and rules (`linkedInLeadGenRefusal`), so it is read here as omitted.
  if (config['objective'] === LINKEDIN_LEAD_GEN_OBJECTIVE) return linkedInObjectiveRefusal(withoutKey(config, 'objective'), enabled);
  if (!('objective' in config || 'conversions' in config)) return null;
  const conversions = config['conversions'];
  const objective = config['objective'];
  const hasConversions = 'conversions' in config;
  if (hasConversions && !(Array.isArray(conversions) && conversions.every((id) => typeof id === 'string'))) {
    return { field: LINKEDIN_CONVERSIONS_FIELD, message: 'Conversions must be a list of conversion rule ids, for example ["104012"].' };
  }
  if ('objective' in config && (typeof objective !== 'string' || objective === '')) {
    return { field: LINKEDIN_OBJECTIVE_FIELD, message: 'The objective must be "traffic" or "conversions". Omit it to let the bidding decide.' };
  }
  if (!enabled) {
    return {
      field: hasConversions ? LINKEDIN_CONVERSIONS_FIELD : LINKEDIN_OBJECTIVE_FIELD,
      message: 'LinkedIn objectives and conversion tracking are not enabled on this deployment. Reload the page and create again.',
    };
  }
  if (hasConversions) {
    const refused = conversionsRefusal(conversions as string[]);
    if (refused !== null) return refused;
  }
  if (objective === undefined) return null;
  if (!(LINKEDIN_OBJECTIVES as readonly unknown[]).includes(objective)) {
    return { field: LINKEDIN_OBJECTIVE_FIELD, message: 'The objective must be "traffic" or "conversions".' };
  }
  const manual = plainRecord(config['bidding'])?.['strategy'] === 'manual';
  if (objective === 'traffic' && manual) {
    return {
      field: LINKEDIN_OBJECTIVE_FIELD,
      message: 'The traffic objective takes automatic bidding only. Choose the conversions objective for a manual bid.',
    };
  }
  if (objective === 'conversions' && !manual && !hasConversions) {
    return {
      field: LINKEDIN_OBJECTIVE_FIELD,
      message: 'Website conversions on automatic bidding needs a conversion rule. Pick one, or choose manual bidding or the traffic objective.',
    };
  }
  return null;
}

/** Whether `raw` names `conversions`, which campaign-service answers only to `global_marketing_ops` on the project. */
export function linkedInConfigNamesConversions(raw: unknown): boolean {
  const config = plainRecord(raw);
  return config !== null && 'conversions' in config;
}

/**
 * The conversion rules a conversions read may offer: enabled rules whose id `linkedInObjectiveRefusal` accepts, each
 * once, in campaign-service's order (by name), named by name (or by the id when the name is blank).
 */
export function linkedInConversionRules(conversions: unknown): LinkedInConversionRule[] {
  if (!Array.isArray(conversions)) return [];
  const seen = new Set<string>();
  const out: LinkedInConversionRule[] = [];
  for (const item of conversions as unknown[]) {
    const record = plainRecord(item);
    const id = record?.['id'];
    if (!record || record['enabled'] !== true || typeof id !== 'string' || !isConversionRuleId(id) || seen.has(id)) continue;
    seen.add(id);
    const name = record['name'];
    out.push({
      id,
      name: typeof name === 'string' && name.trim() !== '' ? name.trim() : id,
      type: typeof record['type'] === 'string' ? record['type'] : '',
    });
  }
  return out;
}
