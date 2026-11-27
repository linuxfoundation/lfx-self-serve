// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  LINKEDIN_CONVERSIONS_ACCESS_UNAVAILABLE_CODE,
  LINKEDIN_CONVERSIONS_ACCESS_UNAVAILABLE_MESSAGE,
  LINKEDIN_CONVERSIONS_FAILED_MESSAGE,
  LINKEDIN_CONVERSIONS_LOADING_MESSAGE,
  LINKEDIN_CONVERSIONS_OWNER_MESSAGE,
  LINKEDIN_CONVERSIONS_RESTRICTED_MESSAGE,
  LINKEDIN_LEAD_GEN_OBJECTIVE,
  LINKEDIN_MAX_CONVERSIONS,
  LINKEDIN_OBJECTIVES,
} from '../constants/campaign.constants';
import type {
  LinkedInCampaignCreateRequest,
  LinkedInConversionRule,
  LinkedInConversionsState,
  LinkedInLeadGenObjective,
  LinkedInObjective,
  LinkedInObjectiveCreateInput,
  LinkedInObjectiveDraft,
} from '../interfaces/campaign.interface';
import {
  linkedInLeadGenChosen,
  linkedInLeadGenCreateRefusal,
  linkedInLeadGenDraftFromStored,
  linkedInLeadGenFieldsForCreate,
} from './campaign-linkedin-lead-gen-form.utils';
import { linkedInObjectiveRefusal } from './campaign-linkedin-objective.utils';

/**
 * The Implement tab's LinkedIn objective and conversion rules (#5764 rows 2 and 4): what the create sends, when it is
 * held, what the picker offers and says, and what a stored draft restores (its target cost included; the target cost's
 * own rules are in `campaign-linkedin-target-cost.utils.ts`). The create's own checks are
 * `linkedInObjectiveRefusal`, reused here against the request the tab would send.
 */

/** No objective chosen (the bidding decides, as before) and no conversion rule picked. */
export function emptyLinkedInObjectiveDraft(): LinkedInObjectiveDraft {
  return { objective: null, conversions: [], conversionsOwner: null };
}

/**
 * Whether the picker shows the objective: on an explicit yes, and while a choice is held after it is withdrawn, so the
 * operator can set it back to the default.
 */
export function linkedInObjectiveShown(draft: LinkedInObjectiveDraft, available: boolean): boolean {
  return available || draft.objective !== null;
}

/** The objective a select value names (lead generation included), or `null` (the default) for any other value. */
export function linkedInObjectiveChoice(value: unknown): LinkedInObjective | LinkedInLeadGenObjective | null {
  if (value === LINKEDIN_LEAD_GEN_OBJECTIVE) return LINKEDIN_LEAD_GEN_OBJECTIVE;
  return (LINKEDIN_OBJECTIVES as readonly unknown[]).includes(value) ? (value as LinkedInObjective) : null;
}

/**
 * The `objective` and `conversions` a create sends: nothing while the capability is off or no objective is chosen, so a
 * create without a choice sends exactly what it always did; the conversion rules only with the `conversions`
 * objective, and only when some are picked. Lead generation rides its own capability (`leadGenAvailable`) and sends
 * `linkedInLeadGenFieldsForCreate`.
 */
export function linkedInObjectiveFieldsForCreate(
  draft: LinkedInObjectiveDraft,
  available: boolean,
  leadGenAvailable = false
): Pick<LinkedInCampaignCreateRequest, 'objective' | 'conversions' | 'leadGenForm' | 'leadGenCallToAction'> {
  if (linkedInLeadGenChosen(draft)) return leadGenAvailable ? linkedInLeadGenFieldsForCreate(draft) : {};
  if (!available || draft.objective === null) return {};
  if (draft.objective === 'conversions' && draft.conversions.length > 0) return { objective: draft.objective, conversions: [...draft.conversions] };
  return { objective: draft.objective };
}

/**
 * `draft` with `conversions` picked, recording who they were picked for: none once the list is empty; `owner` for the
 * first rule picked; else the draft's own, so a rule added beside ones picked for another owner does not make those
 * sendable.
 */
export function linkedInObjectiveDraftWithConversions(draft: LinkedInObjectiveDraft, conversions: string[], owner: string): LinkedInObjectiveDraft {
  if (conversions.length === 0) return { ...draft, conversions: [], conversionsOwner: null };
  return { ...draft, conversions, conversionsOwner: draft.conversions.length > 0 ? draft.conversionsOwner : owner };
}

/** Why the conversion rules a create would send were picked for another owner than `owner`, or `null`. Held, never dropped. */
export function linkedInConversionsOwnerRefusal(draft: LinkedInObjectiveDraft, owner: string): string | null {
  const sent = linkedInObjectiveFieldsForCreate(draft, true).conversions;
  return sent && draft.conversionsOwner !== owner ? LINKEDIN_CONVERSIONS_OWNER_MESSAGE : null;
}

/**
 * Why the LinkedIn objective holds Create, or `null` (#5764 rows 2 and 4). Nothing chosen holds nothing. A choice this
 * deployment no longer offers is held rather than dropped, rules picked for another owner are held, and otherwise the
 * request the tab would send (with its bidding) is checked by `linkedInObjectiveRefusal`, as the create route will.
 * Lead generation is `linkedInLeadGenCreateRefusal`'s.
 */
export function linkedInObjectiveCreateRefusal(input: LinkedInObjectiveCreateInput): string | null {
  const { draft, available, owner, bidding } = input;
  if (draft.objective === null) return null;
  if (linkedInLeadGenChosen(draft))
    return linkedInLeadGenCreateRefusal(draft, { available: input.leadGenAvailable === true, owner, bidding, format: input.format });
  if (!available) return 'LinkedIn Ads: the campaign objective is not available right now. Choose "Set by bidding" as the objective.';
  const ownerRefusal = linkedInConversionsOwnerRefusal(draft, owner);
  if (ownerRefusal !== null) return `LinkedIn Ads: ${ownerRefusal}`;
  const refused = linkedInObjectiveRefusal(
    { ...linkedInObjectiveFieldsForCreate(draft, true), ...(bidding ? { bidding } : {}) },
    true,
    input.trafficManualBidAvailable === true
  );
  return refused === null ? null : `LinkedIn Ads: ${refused.message}`;
}

/**
 * What the LinkedIn bidding control says Manual creates, when it is not its usual Website conversions campaign: a
 * Website visits campaign while the traffic objective is chosen and this deployment can send it with a manual bid
 * (campaign-service#676). `null` keeps the usual text.
 */
export function linkedInManualBidDescription(objective: LinkedInObjectiveDraft['objective'], trafficManualBidAvailable: boolean): string | null {
  return objective === 'traffic' && trafficManualBidAvailable ? 'Creates a website-visits campaign with a manual cost-per-click bid.' : null;
}

/** Whether another conversion rule may be picked: campaign-service tracks at most `LINKEDIN_MAX_CONVERSIONS`. */
export function linkedInCanAddConversion(draft: LinkedInObjectiveDraft): boolean {
  return draft.conversions.length < LINKEDIN_MAX_CONVERSIONS;
}

/** The read's failure as the picker shows it: the caller's role on a 403, else a coded outage or a plain failure. */
export function linkedInConversionsFailure(status: number, code: unknown): LinkedInConversionsState {
  if (status === 403) return { status: 'restricted', conversions: [], failure: LINKEDIN_CONVERSIONS_RESTRICTED_MESSAGE };
  const failure =
    status === 503 && code === LINKEDIN_CONVERSIONS_ACCESS_UNAVAILABLE_CODE
      ? LINKEDIN_CONVERSIONS_ACCESS_UNAVAILABLE_MESSAGE
      : LINKEDIN_CONVERSIONS_FAILED_MESSAGE;
  return { status: 'unavailable', conversions: [], failure };
}

/** The rules the picker may still add: the loaded ones not already picked. */
export function linkedInConversionChoices(state: LinkedInConversionsState, picked: readonly string[]): LinkedInConversionRule[] {
  return state.conversions.filter((rule) => !picked.includes(rule.id));
}

/** The picked rules as chips: named from the read when it lists them, else by id (picked for another account, or not loaded). */
export function linkedInConversionPicks(state: LinkedInConversionsState, picked: readonly string[]): { id: string; name: string }[] {
  return picked.map((id) => ({ id, name: state.conversions.find((rule) => rule.id === id)?.name ?? id }));
}

/** What the picker says about the read, or `null` when it has rules to offer. */
export function linkedInConversionsMessage(state: LinkedInConversionsState, choiceCount: number): string | null {
  if (state.status === 'loading') return LINKEDIN_CONVERSIONS_LOADING_MESSAGE;
  if (state.status !== 'loaded') return state.failure;
  if (state.conversions.length === 0) return 'No enabled conversion rules on this ad account. Add one in LinkedIn Campaign Manager, or choose manual bidding.';
  if (choiceCount === 0) return 'Every conversion rule on this ad account is picked.';
  return null;
}

/**
 * A stored objective draft the picker can show, or `null`: a draft is replayed from stored JSON whose inner shape is not
 * validated. An unknown objective restores as the default. Only text ids are kept, since no other can be shown or sent;
 * a text id that is not a valid rule id is kept as it is, so the create's check holds it rather than it being dropped.
 */
export function linkedInObjectiveDraftFromStored(raw: unknown): LinkedInObjectiveDraft | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const stored = record['conversions'];
  const conversions = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  const owner = record['conversionsOwner'];
  const targetCost = record['targetCost'];
  return {
    objective: linkedInObjectiveChoice(record['objective']),
    conversions,
    conversionsOwner: conversions.length > 0 && typeof owner === 'string' ? owner : null,
    // The target cost as typed (campaign-service#674), only as text: the create's check holds a bad one.
    ...(typeof targetCost === 'string' && targetCost !== '' ? { targetCost } : {}),
    // The lead gen form and button (campaign-service#664), only as text.
    ...linkedInLeadGenDraftFromStored(record),
  };
}
