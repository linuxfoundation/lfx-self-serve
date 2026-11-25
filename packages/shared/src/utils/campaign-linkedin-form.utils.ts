// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_MAX_VARIANTS, LINKEDIN_MIN_DAILY_BUDGET_USD } from '../constants/campaign.constants';
import type {
  LinkedInAccountFieldsInput,
  LinkedInCampaignCreateRequest,
  LinkedInCreateAccountOption,
  LinkedInCreateAccountResult,
  LinkedInCreateRefusalInput,
  LinkedInCreativeVariant,
  LinkedInDailyCapInput,
  LinkedInTargetingFacets,
  LinkedInTargetingProfileConfig,
  LinkedInTargetingProfileEdit,
  LinkedInVariantDraft,
  LinkedInVariantFieldsEnabled,
} from '../interfaces/campaign.interface';
import { linkedInVariantImageForBrief } from './campaign-linkedin-image.utils';
import { linkedInCreativeTextLength, normalizeLinkedInCreativeName, roundUsdToCentsLikeGo } from './campaign-linkedin.utils';
import { linkedInTextAdsCreateRefusal } from './campaign-linkedin-text-ads-form.utils';

/**
 * The Implement tab's LinkedIn form rules (#5980): the daily cap, the targeting edit, the ad account, the variants a
 * create sends and why Create is held. One place for the rules, tested as table rows; the component only wires its
 * signals to them.
 */

/**
 * Mirrors campaign-service's `linkedin.ValidateDailyCap` (#5774): compared at two-decimal wire precision, at least
 * LinkedIn's $10 daily minimum, and no more than the lifetime budget. No cap, no lifetime budget or a deployment that
 * does not offer the cap is never an error, since nothing is sent.
 */
export function linkedInDailyCapError({ capUsd, lifetimeBudget, available, budgetUsd }: LinkedInDailyCapInput): string | null {
  if (capUsd === null || !lifetimeBudget || !available) return null;
  if (!Number.isFinite(capUsd)) return 'Enter the daily cap in US dollars, or leave it empty for no cap.';
  // Rounded exactly as campaign-service rounds both amounts, ties to the even cent.
  const rounded = roundUsdToCentsLikeGo(capUsd);
  if (rounded < LINKEDIN_MIN_DAILY_BUDGET_USD) return `The daily cap must be at least $${LINKEDIN_MIN_DAILY_BUDGET_USD}, LinkedIn's daily minimum.`;
  if (rounded > roundUsdToCentsLikeGo(budgetUsd)) return "The daily cap can't be more than the lifetime budget.";
  return null;
}

/** `{ dailyCapUsd }` when a cap is set beside a lifetime budget on a deployment that offers it (#5774), else nothing. */
export function linkedInDailyCapField({ capUsd, lifetimeBudget, available }: LinkedInDailyCapInput): Pick<LinkedInCampaignCreateRequest, 'dailyCapUsd'> {
  return available && lifetimeBudget && capUsd !== null ? { dailyCapUsd: capUsd } : {};
}

/** Whether any targeting entry was removed from the selected profile (#5546). */
export function linkedInTargetingRemovalsHeld(removals: LinkedInTargetingFacets | null | undefined): boolean {
  return !!removals && removals.skills.length + removals.groups.length > 0;
}

/**
 * The edit a create sends as `targetingProfileEdit` (#5546), or `null` when nothing was removed. `effective` is the
 * profile after removals; the edit is keyed by the profile's own id, so `custom` reads `cloud-native`.
 */
export function linkedInTargetingEdit(
  profile: LinkedInTargetingProfileConfig | null,
  effective: LinkedInTargetingFacets | null
): LinkedInTargetingProfileEdit | null {
  if (!profile || !effective) return null;
  if (effective.skills.length === profile.skills.length && effective.groups.length === profile.groups.length) return null;
  return { id: profile.id, skills: effective.skills, groups: effective.groups };
}

/** Whether an edit removed every skill and group, so the campaign targets only the job functions. */
export function linkedInTargetingEmptyWarning(effective: LinkedInTargetingFacets | null, edit: LinkedInTargetingProfileEdit | null): boolean {
  return !!effective && edit !== null && effective.skills.length === 0 && effective.groups.length === 0;
}

/**
 * The account a LinkedIn create goes to (#5809), or `null` while the read has no answer. The default when the caller
 * cannot choose, or when the chosen id is not one of the listed accounts.
 */
export function linkedInEffectiveAccount(account: LinkedInCreateAccountResult | null, chosenId: string): LinkedInCreateAccountOption | null {
  if (!account) return null;
  const fallback: LinkedInCreateAccountOption = { accountId: account.accountId, orgId: account.orgId, label: account.label, isDefault: true };
  const defaultAccount = account.accounts.find((a) => a.isDefault) ?? fallback;
  if (!account.canChoose) return defaultAccount;
  return account.accounts.find((a) => a.accountId === chosenId) ?? defaultAccount;
}

/**
 * The account fields a LinkedIn create sends (#5809). The legacy creator reads the form's `adAccountId`. When the
 * connection decides the account, only a chosen account that is NOT the default goes out, as `selectedAdAccountId`:
 * while campaign-service's account selection is on it refuses ANY `adAccountId`, the default included, from a caller
 * without `global_marketing_ops`, so the default is sent as nothing.
 */
export function linkedInAccountFields({
  setByConnection,
  selectionAvailable,
  effectiveAccount,
  canChoose,
  legacyAccountId,
}: LinkedInAccountFieldsInput): Pick<LinkedInCampaignCreateRequest, 'adAccountId' | 'selectedAdAccountId'> {
  if (!setByConnection) return { adAccountId: legacyAccountId };
  if (!selectionAvailable || !canChoose || !effectiveAccount || effectiveAccount.isDefault) return {};
  return { selectedAdAccountId: effectiveAccount.accountId };
}

/**
 * The variants a create sends. A variant's upload goes out only when the upload capability is an explicit yes
 * (`uploadAvailable`) and it was made for the open brief; it replaces any `imageUrn` the plan named, since
 * campaign-service refuses a variant carrying both. A variant with neither sends no image field. The tab-only fields
 * (`key`, the asset's name and brief) are never sent.
 */
export function linkedInVariantsForCreate(
  variants: readonly LinkedInVariantDraft[],
  uploadAvailable: boolean,
  briefId: string,
  fields: LinkedInVariantFieldsEnabled = { copy: false, callToAction: false }
): LinkedInCreativeVariant[] {
  return variants.map((variant) => {
    const { introText, headline } = variant;
    const optional = linkedInVariantOptionalFields(variant, fields);
    if (uploadAvailable && linkedInVariantImageForBrief(variant, briefId)) return { introText, headline, imageAssetId: variant.imageAssetId, ...optional };
    return variant.imageUrn ? { introText, headline, imageUrn: variant.imageUrn, ...optional } : { introText, headline, ...optional };
  });
}

/**
 * A variant's ad name, description and call to action as a create sends them (#5764 rows 16–17): only on a deployment
 * that sends each (`fields`), and only when set. A blank one is not set, as campaign-service reads it.
 */
function linkedInVariantOptionalFields(
  variant: LinkedInVariantDraft,
  fields: LinkedInVariantFieldsEnabled
): Pick<LinkedInCreativeVariant, 'name' | 'description' | 'callToAction'> {
  const out: Pick<LinkedInCreativeVariant, 'name' | 'description' | 'callToAction'> = {};
  // Blank as campaign-service reads it: the normalized name, and the description's normalized length.
  if (fields.copy && normalizeLinkedInCreativeName(variant.name ?? '') !== '') out.name = variant.name;
  if (fields.copy && linkedInCreativeTextLength(variant.description ?? '') > 0) out.description = variant.description;
  if (fields.callToAction && (variant.callToAction ?? '') !== '') out.callToAction = variant.callToAction;
  return out;
}

/** Why the LinkedIn section holds Create, or `null`. The first failing check wins; each message names its fix. */
export function linkedInCreateRefusal(input: LinkedInCreateRefusalInput): string | null {
  if (input.budgetUsd < 1) return 'LinkedIn Ads: set a budget of at least $1.';
  // A daily cap campaign-service would refuse (#5774); the message is under the field.
  if (input.dailyCapError !== null) return 'LinkedIn Ads: fix the daily cap.';
  if (input.geoTargetCount === 0) return 'LinkedIn Ads: add at least one location.';
  // A Text Ads choice this deployment no longer offers is held rather than sent as single image ads (#5764 row 19).
  if (input.textAdsUnavailable) return 'LinkedIn Ads: Text Ads are not available right now. Choose single image ads as the ad format.';
  // Custom targeting this deployment no longer offers is held rather than sent as the profile, a wider audience (#5764 rows 8–11).
  if (input.customTargetingUnavailable) return 'LinkedIn Ads: custom targeting is not available right now. Choose a targeting profile.';
  if (input.textAds) {
    // Text Ads (#5764 row 19) take the variants' place: the create sends none.
    const textAdsRefusal = linkedInTextAdsCreateRefusal(input.textAds);
    if (textAdsRefusal !== null) return textAdsRefusal;
  } else {
    if (input.variantCount === 0) return 'LinkedIn Ads: add at least one ad variant.';
    if (input.variantCount > LINKEDIN_MAX_VARIANTS) return `LinkedIn Ads: remove ad variants until there are at most ${LINKEDIN_MAX_VARIANTS}.`;
    // An intro text or headline campaign-service would refuse (blank) or cut short (over its limit).
    if (input.variantTextInvalid) return 'LinkedIn Ads: fix the ad variant text.';
    // An ad name or description campaign-service would refuse or cut (#5764 rows 16–17); the message is under the field.
    if (input.variantFieldsInvalid) return 'LinkedIn Ads: fix the ad name or description.';
  }
  // Custom targeting (#5764 rows 8–11) replaces the profile, so its removals are not sent and hold nothing.
  if (input.customTargeting) {
    if (input.customTargeting.refusal !== null) return `LinkedIn Ads: fix the custom targeting. ${input.customTargeting.refusal}`;
  } else if (input.removalsHeld) {
    // Removals the create cannot carry (#5546): the legacy creator would drop them, and without the profile catalogue
    // they cannot be applied. A block rather than a silent revert to the profile as configured.
    if (!input.targetingEditAvailable) return 'LinkedIn Ads: targeting changes are not available right now. Reset the targeting profile.';
    if (!input.profileLoaded) return "LinkedIn Ads: the targeting profile's details have not loaded. Reload the page, or reset the targeting profile.";
  }
  // The objective and conversion rules (#5764 rows 2 and 4): already a whole message (`linkedInObjectiveCreateRefusal`).
  if (input.objectiveRefusal) return input.objectiveRefusal;
  // The legacy account must be one the CATALOG confirms, not merely a non-empty string: before the catalog read
  // returns, and for good if it fails, the restored id is still on the form while the selector shows nothing.
  // Membership also covers the blank id. Skipped when the connection decides the account (#5809), since the create
  // does not send it.
  if (!input.accountSetByConnection && !input.accountInCatalog) return 'LinkedIn Ads: choose an ad account.';
  // While the ad account read is in flight the picker is not shown yet, so a create would go to the default before
  // the operator could see or change it (#5809). A failed read does not block: the create goes to the default.
  if (input.accountSelectionAvailable && input.createAccountStatus === 'loading') return 'LinkedIn Ads: the ad account is still loading.';
  return null;
}
