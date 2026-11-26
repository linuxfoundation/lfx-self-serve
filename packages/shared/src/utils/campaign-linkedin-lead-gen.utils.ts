// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  LINKEDIN_LEAD_GEN_CALL_TO_ACTION_FIELD,
  LINKEDIN_LEAD_GEN_CALL_TO_ACTION_LABELS,
  LINKEDIN_LEAD_GEN_DEFAULT_CALL_TO_ACTION,
  LINKEDIN_LEAD_GEN_FORM_FIELD,
  LINKEDIN_LEAD_GEN_OBJECTIVE,
  LINKEDIN_OBJECTIVE_FIELD,
} from '../constants/campaign.constants';
import type { LinkedInConfigKeyRefusal, LinkedInLeadForm } from '../interfaces/campaign.interface';
import { isLinkedInLongId } from './campaign-linkedin-objective.utils';
import { goTrimSpace } from './campaign-linkedin.utils';
import { compactLinkedInVariantFields } from './campaign-linkedin-variant-fields.utils';

/**
 * LinkedIn Lead Gen Form campaigns (linuxfoundation/lfx-v2-campaign-service#664), mirroring campaign-service's checks
 * (`checkLeadGenShape` and `linkedinLeadGen` in `internal/dispatch/linkedin_lead_gen.go`, the `lead_generation` arm of
 * `linkedinObjective`, and `ValidateLeadGen` in `internal/platform/linkedin/lead_gen.go`), so a create campaign-service
 * would refuse is refused here first, with a field to point at.
 */

/** The creative destination's URN type; `leadGenForm` may be given as the id or as this prefix and the id. */
const AD_FORM_URN_PREFIX = 'urn:li:adForm:';

/**
 * The formats a lead gen create cannot take: LinkedIn has no lead gen Text Ad, and campaign-service builds no lead gen
 * carousel or boost (a boosted post's creative carries no form, #673).
 */
const LEAD_GEN_REFUSED_FORMATS: readonly unknown[] = ['text', 'carousel', 'boost'];

/** The form's state LinkedIn serves nothing from: never listed, and campaign-service refuses a create naming one. */
const ARCHIVED_FORM_STATE = 'ARCHIVED';

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The bare form id of a `leadGenForm` given as the id or as `urn:li:adForm:<id>`, or `null` when it is neither. */
export function linkedInLeadGenFormId(raw: string): string | null {
  // Go's `strings.TrimSpace`, as campaign-service trims it; JavaScript's `trim()` differs at U+0085 and U+FEFF.
  const trimmed = goTrimSpace(raw);
  const id = trimmed.startsWith(AD_FORM_URN_PREFIX) ? trimmed.slice(AD_FORM_URN_PREFIX.length) : trimmed;
  return isLinkedInLongId(id) ? id : null;
}

/**
 * Why `raw`'s lead gen fields cannot be sent, or `null` (campaign-service#664). Typed runtime checks, since the create
 * route has no body validator. A create is lead gen when its `objective` is `lead_generation`; a `null` field, a blank
 * `leadGenForm` (Go's whitespace) or an empty `leadGenCallToAction` counts as omitted, as campaign-service reads them. With none of the three, nothing is
 * checked. Refused, in campaign-service's order:
 *
 * - a `leadGenForm` or `leadGenCallToAction` that is neither text nor `null`;
 * - any of the three while this deployment cannot send them (`enabled`): refused, never dropped, since the legacy creator
 *   ignores them and campaign-service refuses them while `LINKEDIN_ADS_LEAD_GEN_ENABLED` is off;
 * - a form or a label without the `lead_generation` objective;
 * - a manual bid: a lead gen campaign optimises for leads with automatic bidding only;
 * - `lead_generation` without a form, or a form that is not a positive integer id or `urn:li:adForm:<id>`;
 * - a label outside `LINKEDIN_LEAD_GEN_CALL_TO_ACTION_LABELS`, spelled exactly (omitted is `REGISTER`);
 * - `format: "text"`, `"carousel"` or `"boost"`, `offsiteDeliveryEnabled: true` (LinkedIn serves no lead gen on the Audience
 *   Network), and a variant's call to action, since the form's button is the call to action.
 *
 * Messages never echo a caller value.
 */
export function linkedInLeadGenRefusal(raw: unknown, enabled: boolean): LinkedInConfigKeyRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  for (const [key, field] of [
    ['leadGenForm', LINKEDIN_LEAD_GEN_FORM_FIELD],
    ['leadGenCallToAction', LINKEDIN_LEAD_GEN_CALL_TO_ACTION_FIELD],
  ] as const) {
    if (key in config && config[key] !== null && typeof config[key] !== 'string')
      return { field, message: 'Send it as text, for example "6755260984438374400".' };
  }
  const leadGen = config['objective'] === LINKEDIN_LEAD_GEN_OBJECTIVE;
  const form = typeof config['leadGenForm'] === 'string' ? config['leadGenForm'] : '';
  const label = typeof config['leadGenCallToAction'] === 'string' ? config['leadGenCallToAction'] : '';
  const hasForm = goTrimSpace(form) !== '';
  const hasLabel = label !== '';
  if (!leadGen && !hasForm && !hasLabel) return null;
  if (!enabled) {
    let field = LINKEDIN_OBJECTIVE_FIELD;
    if (hasForm) field = LINKEDIN_LEAD_GEN_FORM_FIELD;
    else if (hasLabel) field = LINKEDIN_LEAD_GEN_CALL_TO_ACTION_FIELD;
    return { field, message: 'LinkedIn lead gen form campaigns are not enabled on this deployment. Reload the page and create again.' };
  }
  if (!leadGen) {
    return {
      field: hasForm ? LINKEDIN_LEAD_GEN_FORM_FIELD : LINKEDIN_LEAD_GEN_CALL_TO_ACTION_FIELD,
      message: 'A lead gen form and its button are only sent with the lead generation objective.',
    };
  }
  if (plainRecord(config['bidding'])?.['strategy'] === 'manual') {
    return { field: LINKEDIN_OBJECTIVE_FIELD, message: 'The lead generation objective takes automatic bidding only. Remove the manual bid.' };
  }
  if (!hasForm) return { field: LINKEDIN_LEAD_GEN_FORM_FIELD, message: 'The lead generation objective needs a lead gen form. Pick one.' };
  if (linkedInLeadGenFormId(form) === null) {
    return { field: LINKEDIN_LEAD_GEN_FORM_FIELD, message: 'A lead gen form must be its numeric id or urn:li:adForm:<id>.' };
  }
  if (!(LINKEDIN_LEAD_GEN_CALL_TO_ACTION_LABELS as readonly string[]).includes(label || LINKEDIN_LEAD_GEN_DEFAULT_CALL_TO_ACTION)) {
    return { field: LINKEDIN_LEAD_GEN_CALL_TO_ACTION_FIELD, message: 'Choose one of the lead gen form buttons LinkedIn offers.' };
  }
  if (LEAD_GEN_REFUSED_FORMATS.includes(config['format'])) {
    return { field: 'linkedInConfig.format', message: 'Lead gen form campaigns run single image or video ads. Choose one of those formats.' };
  }
  // Unreachable on the create route until `offsiteDeliveryEnabled` joins `LINKEDIN_CONFIG_REQUEST_KEYS` (campaign-service
  // #667): mirrored now so lead gen is already refused beside it then.
  if (config['offsiteDeliveryEnabled'] === true) {
    return { field: 'linkedInConfig.offsiteDeliveryEnabled', message: 'LinkedIn does not serve lead gen form ads on the Audience Network. Turn it off.' };
  }
  const variants = Array.isArray(config['variants']) ? (config['variants'] as unknown[]) : [];
  const withButton = variants.findIndex((variant) => {
    const record = plainRecord(variant);
    return record !== null && compactLinkedInVariantFields(record).callToAction !== undefined;
  });
  if (withButton !== -1) {
    return {
      field: `linkedInConfig.variants[${withButton}].callToAction`,
      message: "A lead gen form ad's button is the form's. Remove the ad's own call to action.",
    };
  }
  return null;
}

/** Whether `raw` names a non-blank `leadGenForm`, which campaign-service answers only to `global_marketing_ops` on the project. */
export function linkedInConfigNamesLeadGenForm(raw: unknown): boolean {
  const form = plainRecord(raw)?.['leadGenForm'];
  return typeof form === 'string' && goTrimSpace(form) !== '';
}

/**
 * The forms a lead form read may offer: forms whose id `linkedInLeadGenRefusal` accepts and that are not archived, each
 * once, in campaign-service's order (by name), named by name (or by the id when the name is blank).
 */
export function linkedInLeadForms(forms: unknown): LinkedInLeadForm[] {
  if (!Array.isArray(forms)) return [];
  const seen = new Set<string>();
  const out: LinkedInLeadForm[] = [];
  for (const item of forms as unknown[]) {
    const record = plainRecord(item);
    const id = record?.['id'];
    const state = typeof record?.['state'] === 'string' ? record['state'] : '';
    if (!record || typeof id !== 'string' || !isLinkedInLongId(id) || state === ARCHIVED_FORM_STATE || seen.has(id)) continue;
    seen.add(id);
    const name = record['name'];
    out.push({ id, name: typeof name === 'string' && name.trim() !== '' ? name.trim() : id, state });
  }
  return out;
}
