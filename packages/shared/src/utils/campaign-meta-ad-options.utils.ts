// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_META_OBJECTIVE, META_AD_OPTION_FIELDS } from '../constants/campaign.constants';
import type { MetaAdOptionField, MetaAdOptions, MetaAudienceTargetingRefusal } from '../interfaces/campaign.interface';

/**
 * The Meta call to action, conversion event and optimization goal (#5934): `metaConfig.callToAction`,
 * `conversionEvent` and `optimizationGoal`. One set of rules for the Implement tab (which holds Create on
 * a refusal) and the create route (which answers it with a 400), mirroring campaign-service v1.0.38.
 */

/** Whether `field` applies to a Meta create with this objective; an absent or blank objective is `traffic`, as upstream. */
export function metaAdOptionApplies(field: MetaAdOptionField, objective: unknown): boolean {
  const resolved = typeof objective === 'string' && objective.trim() !== '' ? objective.trim() : DEFAULT_META_OBJECTIVE;
  return field.objectives === null || (field.objectives as readonly string[]).includes(resolved);
}

/** `raw` as a key-value record when it is a plain object, else `undefined`: the untrusted request body narrowed at runtime, not cast. */
export function metaConfigRecord(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

/**
 * Why `raw`'s Meta ad choices cannot be sent with this objective, or `null`. Typed runtime checks, since the
 * create route has no body validator: an absent, null or blank key is "Not set". Values are matched ignoring
 * case, as campaign-service does. `manualBidding` is a `bidding.strategy` of `manual`, a link-click bid cap,
 * which campaign-service refuses with LANDING_PAGE_VIEWS.
 */
export function metaAdOptionsRefusal(raw: unknown, objective: unknown, manualBidding: boolean): MetaAudienceTargetingRefusal | null {
  const record = metaConfigRecord(raw);
  for (const field of META_AD_OPTION_FIELDS) {
    const value = record?.[field.key];
    if (value === undefined || value === null) continue;
    const name = `metaConfig.${field.key}`;
    if (typeof value !== 'string') return { field: name, message: `${field.label} must be text.` };
    const token = value.trim().toUpperCase();
    if (token === '') continue;
    if (!field.values.includes(token)) {
      return { field: name, message: `${field.label} must be one of ${field.values.map(metaAdOptionLabel).join(', ')}.` };
    }
    if (!metaAdOptionApplies(field, objective)) {
      return { field: name, message: `${field.label} applies only to the ${field.objectives?.join(' or ')} objective.` };
    }
    if (field.key === 'optimizationGoal' && token === 'LANDING_PAGE_VIEWS' && manualBidding) {
      return { field: name, message: 'Landing page views cannot be the optimization goal with manual bidding. Choose link clicks or automatic bidding.' };
    }
  }
  return null;
}

/** The choices a create sends for ACCEPTED options ({@link metaAdOptionsRefusal} is `null`): trimmed, upper case, every "Not set" key dropped. */
export function compactMetaAdOptions(raw: unknown): MetaAdOptions {
  const record = metaConfigRecord(raw);
  const out: MetaAdOptions = {};
  for (const { key } of META_AD_OPTION_FIELDS) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim() !== '') out[key] = value.trim().toUpperCase();
  }
  return out;
}

/** The 400 a create gets for a Meta ad choice while its flag is off on this deployment. */
export function metaAdOptionOffMessage(field: MetaAdOptionField): string {
  return `${field.label} is not available for Meta on this deployment. Reload the page, then create again without it.`;
}

/** A value as the dropdown shows it: `SIGN_UP` is "Sign up". */
export function metaAdOptionLabel(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
