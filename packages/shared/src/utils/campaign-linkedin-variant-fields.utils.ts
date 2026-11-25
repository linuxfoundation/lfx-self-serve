// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_CALL_TO_ACTION_LABELS, LINKEDIN_VARIANT_FIELD_LIMITS } from '../constants/campaign.constants';
import type { LinkedInConfigKeyRefusal, LinkedInCreativeVariant, LinkedInVariantFieldsEnabled } from '../interfaces/campaign.interface';
import { goTrimSpace, linkedInCreativeTextLength, normalizeLinkedInCreativeName } from './campaign-linkedin.utils';

/**
 * A LinkedIn variant's optional ad name, description and call to action (#5764 rows 16–17), mirroring campaign-service
 * v1.0.38 (`internal/platform/linkedin/variants.go`, #588, #589). One set of rules for the create route (a 400,
 * `linkedInVariantFieldsRefusal`) and the Implement tab (the errors under each field, `linkedInVariantFieldErrors`).
 */

const FIELD_LABELS = { name: 'ad name', description: 'description', callToAction: 'call to action' } as const;
type VariantField = keyof typeof FIELD_LABELS;
const FIELDS = Object.keys(FIELD_LABELS) as VariantField[];

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Whether `value` is a blank string, which campaign-service reads as not set: an empty name or description once normalized, or a blank call to action. */
function isBlankField(key: VariantField, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (key === 'name') return normalizeLinkedInCreativeName(value) === '';
  if (key === 'description') return linkedInCreativeTextLength(value) === 0;
  return value.trim() === '';
}

/** A call to action as campaign-service matches it: trimmed and upper-cased. `''` is none. */
function callToActionToken(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Why `raw`'s variants cannot send their ad name, description or call to action, or `null`. Typed runtime checks, since
 * the create route has no body validator; an absent, null or blank field is not set.
 *
 * - a field present while this deployment does not send it (`enabled`): refused, never dropped. The ad name and
 *   description need the campaign-service create path, since the legacy creator ignores them; the call to action also
 *   needs its flag, since campaign-service refuses it otherwise;
 * - not text, a name over 255 or a description over 300 characters once normalized (campaign-service would cut it), or
 *   a call to action outside `LINKEDIN_CALL_TO_ACTION_LABELS`;
 * - two variants with the same name once normalized, which campaign-service refuses because Campaign Manager could not
 *   tell them apart.
 *
 * Messages never echo a caller value.
 */
export function linkedInVariantFieldsRefusal(raw: unknown, enabled: LinkedInVariantFieldsEnabled): LinkedInConfigKeyRefusal | null {
  const variants = plainRecord(raw)?.['variants'];
  if (!Array.isArray(variants)) return null;
  const names = new Map<string, number>();
  for (const [index, item] of variants.entries()) {
    const variant = plainRecord(item);
    if (!variant) continue;
    for (const key of FIELDS) {
      const value = variant[key];
      if (value === undefined || value === null) continue;
      const field = `linkedInConfig.variants[${index}].${key}`;
      const label = FIELD_LABELS[key];
      const on = key === 'callToAction' ? enabled.callToAction : enabled.copy;
      // A blank value is not set, as campaign-service reads it, so it carries nothing to refuse or drop.
      if (!on && !isBlankField(key, value)) return { field, message: `This deployment cannot send a LinkedIn ${label}. Clear it to create the campaign.` };
      if (typeof value !== 'string') return { field, message: `The ${label} must be text.` };
      if (key === 'name') {
        const name = normalizeLinkedInCreativeName(value);
        if (Array.from(name).length > LINKEDIN_VARIANT_FIELD_LIMITS.name) {
          return { field, message: `The ad name can be at most ${LINKEDIN_VARIANT_FIELD_LIMITS.name} characters.` };
        }
        const first = names.get(name);
        if (name !== '' && first !== undefined) {
          return { field, message: `Ad ${index + 1} has the same name as ad ${first + 1}. Give each ad its own name.` };
        }
        if (name !== '') names.set(name, index);
      } else if (key === 'description') {
        if (linkedInCreativeTextLength(value) > LINKEDIN_VARIANT_FIELD_LIMITS.description) {
          return { field, message: `The description can be at most ${LINKEDIN_VARIANT_FIELD_LIMITS.description} characters.` };
        }
      } else {
        const token = callToActionToken(value);
        if (token !== '' && !(LINKEDIN_CALL_TO_ACTION_LABELS as readonly string[]).includes(token)) {
          return { field, message: `The call to action must be one of ${LINKEDIN_CALL_TO_ACTION_LABELS.join(', ')}.` };
        }
      }
    }
  }
  return null;
}

/**
 * The ad name, description and call to action a variant sends, once `linkedInVariantFieldsRefusal` passed: the name
 * normalized, the call to action upper-cased, and a blank one dropped as not set. The description goes as typed, since
 * campaign-service normalizes it the way it does the intro text and headline.
 */
export function compactLinkedInVariantFields(variant: Record<string, unknown>): Pick<LinkedInCreativeVariant, 'name' | 'description' | 'callToAction'> {
  const out: Pick<LinkedInCreativeVariant, 'name' | 'description' | 'callToAction'> = {};
  const { name, description, callToAction } = variant;
  if (typeof name === 'string' && normalizeLinkedInCreativeName(name) !== '') out.name = normalizeLinkedInCreativeName(name);
  if (typeof description === 'string' && linkedInCreativeTextLength(description) > 0) out.description = description;
  if (typeof callToAction === 'string' && callToActionToken(callToAction) !== '') out.callToAction = callToActionToken(callToAction);
  return out;
}

/**
 * Why each variant's ad name or description cannot be sent, for the Implement tab (#5764 rows 16–17): over
 * campaign-service's limits once normalized, or a name another variant already has. `''` for none. The create route
 * refuses the same, so Create is held while any is set.
 */
export function linkedInVariantFieldErrors(
  variants: readonly { name?: string; description?: string }[],
  eventName = ''
): { name: string; description: string }[] {
  // An unnamed ad goes out as "<event> | variant-N" (campaign-service `creativeName`), so a typed name equal to another
  // ad's default collides too. Skipped while the event name is blank: campaign-service refuses that on its own.
  // Go's `strings.TrimSpace`, as campaign-service's `normalizeEventName`; JavaScript's `trim()` differs at U+0085 and U+FEFF.
  const event = goTrimSpace(eventName).replaceAll('|', '-');
  const resolved = variants.map((variant, index) => {
    const typed = normalizeLinkedInCreativeName(variant.name ?? '');
    if (typed !== '') return typed;
    return event === '' ? '' : `${event} | variant-${index + 1}`;
  });
  return variants.map((variant, index) => {
    const name = normalizeLinkedInCreativeName(variant.name ?? '');
    let nameError = '';
    if (Array.from(name).length > LINKEDIN_VARIANT_FIELD_LIMITS.name) {
      nameError = `The ad name can be at most ${LINKEDIN_VARIANT_FIELD_LIMITS.name} characters.`;
    } else if (name !== '') {
      // An earlier ad with the same name, or any unnamed ad whose default is this name.
      const other = resolved.findIndex((n, i) => i !== index && n === name && (i < index || normalizeLinkedInCreativeName(variants[i].name ?? '') === ''));
      if (other !== -1) nameError = `Ad ${other + 1} already has this name. Give each ad its own name.`;
    }
    const tooLong = linkedInCreativeTextLength(variant.description ?? '') > LINKEDIN_VARIANT_FIELD_LIMITS.description;
    return { name: nameError, description: tooLong ? `The description can be at most ${LINKEDIN_VARIANT_FIELD_LIMITS.description} characters.` : '' };
  });
}
