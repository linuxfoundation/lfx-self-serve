// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  LINKEDIN_LEAD_FORM_OWNER_MESSAGE,
  LINKEDIN_LEAD_FORMS_ACCESS_UNAVAILABLE_CODE,
  LINKEDIN_LEAD_FORMS_ACCESS_UNAVAILABLE_MESSAGE,
  LINKEDIN_LEAD_FORMS_FAILED_MESSAGE,
  LINKEDIN_LEAD_FORMS_LOADING_MESSAGE,
  LINKEDIN_LEAD_FORMS_RESTRICTED_MESSAGE,
  LINKEDIN_LEAD_GEN_CALL_TO_ACTION_LABELS,
  LINKEDIN_LEAD_GEN_DEFAULT_CALL_TO_ACTION,
  LINKEDIN_LEAD_GEN_OBJECTIVE,
} from '../constants/campaign.constants';
import type {
  CampaignBiddingConfig,
  LinkedInCampaignCreateRequest,
  LinkedInLeadFormsState,
  LinkedInLeadGenCallToAction,
  LinkedInObjectiveDraft,
} from '../interfaces/campaign.interface';
import { linkedInLeadGenRefusal } from './campaign-linkedin-lead-gen.utils';

/**
 * The Implement tab's LinkedIn lead generation choice (linuxfoundation/lfx-v2-campaign-service#664): what the create
 * sends, when it is held, and what the form picker offers and says. Carried in the objective draft
 * (`LinkedInObjectiveDraft`), beside the objective it belongs to. The create's own checks are `linkedInLeadGenRefusal`,
 * reused here against the request the tab would send.
 */

/** Whether the draft's objective is lead generation, offered or not. While it is, the tab hides what lead gen refuses. */
export function linkedInLeadGenChosen(draft: LinkedInObjectiveDraft): boolean {
  return draft.objective === LINKEDIN_LEAD_GEN_OBJECTIVE;
}

/** The button label a select value names, or the default (Register) for any other value. */
export function linkedInLeadGenCallToActionChoice(value: unknown): LinkedInLeadGenCallToAction {
  return (LINKEDIN_LEAD_GEN_CALL_TO_ACTION_LABELS as readonly unknown[]).includes(value)
    ? (value as LinkedInLeadGenCallToAction)
    : LINKEDIN_LEAD_GEN_DEFAULT_CALL_TO_ACTION;
}

/**
 * The lead gen fields a create sends: the objective, the form when one is picked, and the button label, Register unless
 * another was chosen, so the request says what the screen shows. Without a form the create's check holds it.
 */
export function linkedInLeadGenFieldsForCreate(
  draft: LinkedInObjectiveDraft
): Pick<LinkedInCampaignCreateRequest, 'objective' | 'leadGenForm' | 'leadGenCallToAction'> {
  const form = draft.leadGenForm ?? '';
  return {
    objective: LINKEDIN_LEAD_GEN_OBJECTIVE,
    ...(form !== '' ? { leadGenForm: form } : {}),
    leadGenCallToAction: linkedInLeadGenCallToActionChoice(draft.leadGenCallToAction),
  };
}

/** `draft` with the form `id` picked for `owner`; an empty id removes the form and its owner. */
export function linkedInObjectiveDraftWithLeadGenForm(draft: LinkedInObjectiveDraft, id: string, owner: string): LinkedInObjectiveDraft {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { leadGenForm: _form, leadGenFormOwner: _owner, ...rest } = draft;
  return id === '' ? rest : { ...rest, leadGenForm: id, leadGenFormOwner: owner };
}

/** Why the picked form was picked for another owner than `owner`, or `null`. Held, never dropped. */
export function linkedInLeadFormOwnerRefusal(draft: LinkedInObjectiveDraft, owner: string): string | null {
  return (draft.leadGenForm ?? '') !== '' && draft.leadGenFormOwner !== owner ? LINKEDIN_LEAD_FORM_OWNER_MESSAGE : null;
}

/**
 * Why lead generation holds Create, or `null`: a choice this deployment no longer offers is held rather than dropped, a
 * form picked for another owner is held, and otherwise the request the tab would send (with its bidding and format) is
 * checked by `linkedInLeadGenRefusal`, as the create route will.
 */
export function linkedInLeadGenCreateRefusal(
  draft: LinkedInObjectiveDraft,
  context: { available: boolean; owner: string; bidding?: CampaignBiddingConfig; format?: string }
): string | null {
  if (!context.available) return 'LinkedIn Ads: lead generation is not available right now. Choose another campaign objective.';
  const ownerRefusal = linkedInLeadFormOwnerRefusal(draft, context.owner);
  if (ownerRefusal !== null) return `LinkedIn Ads: ${ownerRefusal}`;
  const request = {
    ...linkedInLeadGenFieldsForCreate(draft),
    ...(context.bidding ? { bidding: context.bidding } : {}),
    ...(context.format ? { format: context.format } : {}),
  };
  const refused = linkedInLeadGenRefusal(request, true);
  return refused === null ? null : `LinkedIn Ads: ${refused.message}`;
}

/** The read's failure as the picker shows it: the caller's role on a 403, else a coded outage or a plain failure. */
export function linkedInLeadFormsFailure(status: number, code: unknown): LinkedInLeadFormsState {
  if (status === 403) return { status: 'restricted', forms: [], failure: LINKEDIN_LEAD_FORMS_RESTRICTED_MESSAGE };
  const failure =
    status === 503 && code === LINKEDIN_LEAD_FORMS_ACCESS_UNAVAILABLE_CODE
      ? LINKEDIN_LEAD_FORMS_ACCESS_UNAVAILABLE_MESSAGE
      : LINKEDIN_LEAD_FORMS_FAILED_MESSAGE;
  return { status: 'unavailable', forms: [], failure };
}

/**
 * The forms the picker offers, as select options: each loaded form, a DRAFT one marked as such (LinkedIn accepts it, but
 * it collects nothing until published), and a picked form the read does not list (picked for another account, or not
 * loaded) kept as its id, so it stays on screen and can be changed. While a form is picked, a first "No form" option
 * (value `''`) clears it: the select does not re-emit the value it holds, so without it a form held for another ad
 * account after a foundation or account switch could not be picked again when it is the only one, and Create would stay
 * held on its owner.
 */
export function linkedInLeadFormOptions(state: LinkedInLeadFormsState, picked: string | undefined): { value: string; label: string }[] {
  const options = state.forms.map((form) => ({ value: form.id, label: form.state === 'DRAFT' ? `${form.name} (draft)` : form.name }));
  if (picked && !state.forms.some((form) => form.id === picked)) options.unshift({ value: picked, label: `Form ${picked}` });
  if (picked) options.unshift({ value: '', label: 'No form (choose again)' });
  return options;
}

/** What the picker says about the read, or `null` when it has forms to offer. */
export function linkedInLeadFormsMessage(state: LinkedInLeadFormsState): string | null {
  if (state.status === 'loading') return LINKEDIN_LEAD_FORMS_LOADING_MESSAGE;
  if (state.status !== 'loaded') return state.failure;
  if (state.forms.length === 0) return 'No lead gen forms on this ad account. Build one in LinkedIn Campaign Manager, then try again.';
  return null;
}

/** The lead gen fields of a stored objective draft: text only, so the create's check holds a bad one rather than it being dropped. */
export function linkedInLeadGenDraftFromStored(
  record: Record<string, unknown>
): Pick<LinkedInObjectiveDraft, 'leadGenForm' | 'leadGenFormOwner' | 'leadGenCallToAction'> {
  const form = record['leadGenForm'];
  const owner = record['leadGenFormOwner'];
  const label = record['leadGenCallToAction'];
  return {
    ...(typeof form === 'string' && form !== '' ? { leadGenForm: form, ...(typeof owner === 'string' ? { leadGenFormOwner: owner } : {}) } : {}),
    ...((LINKEDIN_LEAD_GEN_CALL_TO_ACTION_LABELS as readonly unknown[]).includes(label) ? { leadGenCallToAction: label as LinkedInLeadGenCallToAction } : {}),
  };
}
