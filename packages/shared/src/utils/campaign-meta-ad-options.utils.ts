// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_META_OBJECTIVE, META_AD_OPTION_FIELDS } from '../constants/campaign.constants';
import type {
  CampaignBiddingCapabilityBlock,
  CampaignCapabilityReadState,
  MetaAdOptionField,
  MetaAdOptionKey,
  MetaAdOptions,
  MetaAdOptionsEnabled,
  MetaConfigRefusal,
  MetaTargeting,
} from '../interfaces/campaign.interface';

/**
 * The Meta call to action, conversion event and optimization goal (#5934): `metaConfig.callToAction`,
 * `conversionEvent` and `optimizationGoal`. One set of rules for the Implement tab (which holds Create on
 * a refusal) and the create route (which answers it with a 400), mirroring campaign-service v1.0.38.
 */

/** Whether `field` applies to a Meta create with this objective; matched ignoring case; an absent or blank objective is `traffic`, as upstream. */
export function metaAdOptionApplies(field: MetaAdOptionField, objective: unknown): boolean {
  const resolved = typeof objective === 'string' && objective.trim() !== '' ? objective.trim().toLowerCase() : DEFAULT_META_OBJECTIVE;
  return field.objectives === null || (field.objectives as readonly string[]).includes(resolved);
}

/** `raw` as a key-value record when it is a plain object, else `undefined`: the untrusted request body narrowed at runtime, not cast. */
export function metaConfigRecord(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

/** The `metaConfig` keys the create route reads or rebuilds by their exact spelling. */
const META_CONFIG_EXACT_KEYS = [
  'targeting',
  'objective',
  'placements',
  'lifetimeBudget',
  'leadFormId',
  'adSchedule',
  'frequencyCap',
  'callToAction',
  'conversionEvent',
  'optimizationGoal',
  'bidding',
  'budget',
  'budgetUsd',
  'format',
  'variants',
] as const;
/** The `metaConfig.placements` keys, which the device rules read by their exact spelling. */
const META_PLACEMENT_KEYS = ['facebookFeed', 'instagramFeed', 'stories', 'reels', 'audienceNetwork', 'messengerInbox'] as const;
/**
 * Every `metaConfig.targeting` key, audience and detailed, which the targeting gates and rules read by their exact
 * spelling. A record over `keyof MetaTargeting`, so a key added to the interface fails the type-check until it is listed.
 */
const META_TARGETING_KEY_SET: Record<keyof MetaTargeting, true> = {
  ageMin: true,
  ageMax: true,
  genders: true,
  customAudiences: true,
  excludedCustomAudiences: true,
  advantageAudience: true,
  interests: true,
  behaviors: true,
  workPositions: true,
  locales: true,
  devicePlatforms: true,
  userOs: true,
  regions: true,
  cities: true,
};
const META_TARGETING_KEYS = Object.keys(META_TARGETING_KEY_SET);

/** A key as Go's `encoding/json` matches it: Unicode case folding, which upper-casing first catches (`ſ` is `s`). */
function foldKey(key: string): string {
  return key.toUpperCase().toLowerCase();
}

/** The known key `record` sends under another spelling, or `null`. */
function keyVariantIn(record: Record<string, unknown>, known: readonly string[]): string | null {
  for (const key of Object.keys(record)) {
    const match = known.find((k) => key !== k && foldKey(key) === foldKey(k));
    if (match) return match;
  }
  return null;
}

/**
 * The `metaConfig` field `raw` sends under another spelling of its key, or `null` (#5904 row 6 review). campaign-service
 * decodes keys ignoring case (Unicode folding), but the create route reads and rebuilds each by its exact spelling and
 * forwards the rest untouched, so `Targeting` would reach campaign-service past every targeting gate here, and a
 * differently cased `objective`, `placements.audienceNetwork` or `targeting.regions` past the rules and flag gates
 * that read them (`targeting: { Regions: [...] }` would otherwise reach Meta with no region flag). The route refuses
 * any such key whatever the flags, naming the field it folds to.
 */
export function metaConfigKeyVariant(raw: unknown): string | null {
  const record = metaConfigRecord(raw);
  if (!record) return null;
  const top = keyVariantIn(record, META_CONFIG_EXACT_KEYS);
  if (top !== null) return `metaConfig.${top}`;
  const placements = metaConfigRecord(record['placements']);
  const placement = placements ? keyVariantIn(placements, META_PLACEMENT_KEYS) : null;
  if (placement !== null) return `metaConfig.placements.${placement}`;
  const targeting = metaConfigRecord(record['targeting']);
  const target = targeting ? keyVariantIn(targeting, META_TARGETING_KEYS) : null;
  return target === null ? null : `metaConfig.targeting.${target}`;
}

/**
 * Why `raw`'s Meta ad choices cannot be sent with this objective, or `null`. Typed runtime checks, since the
 * create route has no body validator: an absent, null or blank key is "Not set". Values are matched ignoring
 * case, as campaign-service does. `manualBidding` is a `bidding.strategy` of `manual`, a link-click bid cap,
 * which campaign-service refuses with LANDING_PAGE_VIEWS.
 */
export function metaAdOptionsRefusal(raw: unknown, objective: unknown, manualBidding: boolean): MetaConfigRefusal | null {
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

/** The Meta ad choices a create sends: compacted, and each only on an explicit yes. "Not set" is never sent. */
export function metaAdOptionsForCreate(options: MetaAdOptions, enabled: MetaAdOptionsEnabled): MetaAdOptions {
  return Object.fromEntries(Object.entries(compactMetaAdOptions(options)).filter(([key]) => enabled[key as MetaAdOptionKey] === true));
}

/** The choices after one dropdown change: an empty value ("Not set") removes the key. */
export function metaAdOptionsWithChoice(options: MetaAdOptions, key: MetaAdOptionKey, value: string | null): MetaAdOptions {
  const next = { ...options };
  if (!value) delete next[key];
  else next[key] = value;
  return next;
}

/** The choices the objective still takes; the rest are cleared when the objective changes or a draft is restored. */
export function metaAdOptionsForObjective(options: MetaAdOptions, objective: string): MetaAdOptions {
  return Object.fromEntries(Object.entries(options).filter(([key]) => META_AD_OPTION_FIELDS.some((f) => f.key === key && metaAdOptionApplies(f, objective))));
}

/** The choices without those this deployment answered no to: the way past an `unsupported` {@link metaAdOptionsBlock}. */
export function metaAdOptionsWithoutUnsupported(options: MetaAdOptions, enabled: MetaAdOptionsEnabled): MetaAdOptions {
  return Object.fromEntries(Object.entries(options).filter(([key]) => enabled[key as MetaAdOptionKey] !== false));
}

/**
 * Why Create is held for a Meta ad choice the draft holds but this deployment has not confirmed, or `null`.
 * Held rather than dropped, since the choice changes the ads. Only an explicit no on every held choice
 * (`unsupported`) offers Clear; while an answer is out or failed, Create waits or offers Retry.
 */
export function metaAdOptionsBlock(
  options: MetaAdOptions,
  enabled: MetaAdOptionsEnabled,
  createCapabilityRead: CampaignCapabilityReadState,
  briefId: string | null
): CampaignBiddingCapabilityBlock | null {
  const held = Object.keys(compactMetaAdOptions(options)).filter((key) => enabled[key as MetaAdOptionKey] !== true);
  if (held.length === 0) return null;
  const labels = META_AD_OPTION_FIELDS.filter((field) => held.includes(field.key))
    .map((field) => field.label.toLowerCase())
    .join(', ');
  if (held.every((key) => enabled[key as MetaAdOptionKey] === false)) {
    return { kind: 'unsupported', message: `This deployment cannot send the Meta ${labels} on this brief. Clear it to create the campaign.` };
  }
  if (createCapabilityRead === 'pending') {
    return { kind: 'pending', message: `Checking whether the Meta ${labels} can be sent. Create waits so it is not dropped.` };
  }
  if (!briefId) {
    return { kind: 'unsaved', message: `The Meta ${labels} can't be checked until this brief is saved. Save the brief.` };
  }
  return { kind: 'failed', message: `Could not confirm that the Meta ${labels} can be sent, so Create waits rather than dropping it. Retry the check.` };
}
