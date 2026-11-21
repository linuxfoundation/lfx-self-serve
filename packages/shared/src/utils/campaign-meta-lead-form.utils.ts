// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_META_OBJECTIVE,
  META_LEAD_FORM_CALL_TO_ACTIONS,
  META_LEAD_FORM_ID_PATTERN,
  META_LEAD_FORM_UNAVAILABLE_REFUSAL,
  META_OBJECTIVE_LABELS,
  META_SELECTABLE_OBJECTIVES,
} from '../constants/campaign.constants';
import type {
  MetaConfigRefusal,
  MetaLeadFormChoice,
  MetaLeadFormDraft,
  MetaLeadFormOption,
  MetaLeadFormPickerView,
  MetaLeadFormRestore,
  MetaObjective,
} from '../interfaces/campaign.interface';
import { metaAdOptionLabel, metaConfigRecord } from './campaign-meta-ad-options.utils';

/**
 * The Meta Instant Form of a `leads` create (#5940): `metaConfig.leadFormId`. One set of rules for the Implement
 * tab and the create route, mirroring campaign-service v1.0.38's synchronous 400s. Whether the form is ACTIVE
 * and on the right Page campaign-service checks itself, before it creates anything.
 */

/** The trimmed form id `raw` carries, or `null` for none: absent, null and blank are "Not set". */
export function metaLeadFormId(raw: unknown): string | null {
  const value = metaConfigRecord(raw)?.['leadFormId'];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Whether `raw` carries the lead form under any spelling but `leadFormId` (`LeadFormId`, `leadformid`, ...).
 * campaign-service decodes JSON keys ignoring case, so such a key would reach it past every check on
 * `leadFormId`; the create route refuses it instead.
 */
export function hasMetaLeadFormKeyVariant(raw: unknown): boolean {
  const record = metaConfigRecord(raw);
  return record !== undefined && Object.keys(record).some((key) => key !== 'leadFormId' && key.toLowerCase() === 'leadformid');
}

/**
 * Why `raw`'s lead form cannot be sent, or `null`. Typed runtime checks, since the create route has no body
 * validator. The form needs the `leads` objective (matched ignoring case; absent is `traffic`), automatic
 * bidding (`manualBidding` is a `bidding.strategy` of `manual`, a link-click cap) and a call to action a form
 * can carry, or none.
 */
export function metaLeadFormRefusal(raw: unknown, manualBidding: boolean): MetaConfigRefusal | null {
  const record = metaConfigRecord(raw);
  const value = record?.['leadFormId'];
  if (value === undefined || value === null) return null;
  const field = 'metaConfig.leadFormId';
  if (typeof value !== 'string') return { field, message: 'Lead form must be text.' };
  const id = value.trim();
  if (id === '') return null;
  if (!META_LEAD_FORM_ID_PATTERN.test(id)) return { field, message: 'Lead form must be a Meta form id of up to 20 digits.' };
  const objective = record?.['objective'];
  const resolved = typeof objective === 'string' && objective.trim() !== '' ? objective.trim().toLowerCase() : DEFAULT_META_OBJECTIVE;
  if (resolved !== 'leads') return { field, message: 'A lead form applies only to the Leads objective.' };
  if (manualBidding) return { field, message: 'A lead form cannot be used with manual bidding. Choose automatic bidding.' };
  const callToAction = record?.['callToAction'];
  if (typeof callToAction === 'string' && callToAction.trim() !== '') {
    const token = callToAction.trim().toUpperCase();
    if (!(META_LEAD_FORM_CALL_TO_ACTIONS as readonly string[]).includes(token)) {
      return {
        field: 'metaConfig.callToAction',
        message: `With a lead form, the call to action must be one of ${META_LEAD_FORM_CALL_TO_ACTIONS.map(metaAdOptionLabel).join(', ')}.`,
      };
    }
  }
  return null;
}

/**
 * The objectives the Implement tab offers, in `META_OBJECTIVE_LABELS` order: the always-selectable ones, plus
 * `leads` only when this caller may send a lead form. Without a form `leads` would run as a traffic campaign,
 * which is why it stays hidden otherwise.
 */
export function metaObjectiveChoices(leadFormsEnabled: boolean): MetaObjective[] {
  const selectable = META_SELECTABLE_OBJECTIVES as readonly MetaObjective[];
  return (Object.keys(META_OBJECTIVE_LABELS) as MetaObjective[]).filter(
    (objective) => selectable.includes(objective) || (leadFormsEnabled && objective === 'leads')
  );
}

/** The picker rows for the Page's forms, in the read's (name) order: a form that is not ACTIVE, or whose id campaign-service would refuse, shows its status and cannot be picked. */
export function metaLeadFormChoices(forms: readonly MetaLeadFormOption[]): MetaLeadFormChoice[] {
  return forms.map((form) => {
    const active = form.status.trim().toUpperCase() === 'ACTIVE' && META_LEAD_FORM_ID_PATTERN.test(form.id);
    const status = form.status.trim() === '' ? 'unknown' : form.status.trim().toLowerCase();
    return { value: form.id, label: active ? form.name : `${form.name} (${status})`, disabled: !active };
  });
}

/** The form id to keep after the objective changes: only `leads` carries one, so any other objective clears it. */
export function metaLeadFormForObjective(objective: MetaObjective, leadFormId: string): string {
  return objective === 'leads' ? leadFormId : '';
}

/**
 * The objective to keep after a foundation switch: `leads` falls back to the default, because whether this caller
 * may send a lead form is re-read for the new foundation, and `leads` without a form would go out as traffic.
 */
export function metaObjectiveAfterFoundationSwitch(objective: MetaObjective): MetaObjective {
  return objective === 'leads' ? DEFAULT_META_OBJECTIVE : objective;
}

/** Whether a call to action may be offered with a lead form; without one every call to action may be. */
export function metaCallToActionAllowedWithLeadForm(callToAction: string, withLeadForm: boolean): boolean {
  return !withLeadForm || (META_LEAD_FORM_CALL_TO_ACTIONS as readonly string[]).includes(callToAction.trim().toUpperCase());
}

/**
 * Why the Implement tab's Meta draft cannot be created with its lead form, or `null`. While lead forms are enabled
 * for this caller, `leads` needs a form, so self-serve never sends the traffic-mapped `leads`, and the form must pass
 * the create route's own rules ({@link metaLeadFormRefusal}). While they are off (or not yet read) no form is sent,
 * so a `leads` draft that holds one is held rather than sent as traffic; a `leads` draft without one (saved before
 * lead forms existed) is left as it always was.
 */
export function metaLeadFormDraftRefusal(draft: MetaLeadFormDraft): MetaConfigRefusal | null {
  if (draft.objective !== 'leads') return null;
  const leadFormId = draft.leadFormId.trim();
  if (!draft.leadFormsEnabled) {
    return leadFormId === '' ? null : { field: 'metaConfig.leadFormId', message: META_LEAD_FORM_UNAVAILABLE_REFUSAL };
  }
  if (leadFormId === '') return { field: 'metaConfig.leadFormId', message: 'Choose a lead form for the Leads objective.' };
  return metaLeadFormRefusal({ leadFormId, objective: draft.objective, callToAction: draft.callToAction }, draft.manualBidding);
}

/**
 * The objective and form a saved draft restores to under `activeProject`. A form is restored only under the
 * foundation it was picked under. A draft whose form was saved under another foundation also drops `leads` to the
 * default, as an in-place foundation switch does ({@link metaObjectiveAfterFoundationSwitch}): leaving the tab,
 * switching foundation and coming back must not bring `leads` back without its form. `leadFormId` is `null` when
 * the draft has nothing to restore, so the current form is kept. An unknown active foundation (`''`) changes nothing.
 */
export function metaLeadFormRestore(saved: { objective: MetaObjective; leadFormId?: string; project?: string }, activeProject: string): MetaLeadFormRestore {
  if (saved.leadFormId === undefined || activeProject === '') return { objective: saved.objective, leadFormId: null };
  if (saved.project !== activeProject) return { objective: metaObjectiveAfterFoundationSwitch(saved.objective), leadFormId: '' };
  return { objective: saved.objective, leadFormId: metaLeadFormForObjective(saved.objective, saved.leadFormId) };
}

/**
 * What the lead form picker shows once the Page's forms are read. A held id the list does not show (a typed or
 * restored one) stays on screen in the select, even when the list is empty, so it can be seen and cleared rather
 * than sent unseen.
 */
export function metaLeadFormPickerView(choices: readonly MetaLeadFormChoice[], heldId: string): MetaLeadFormPickerView {
  const heldIdUnlisted = heldId !== '' && !choices.some((choice) => choice.value === heldId);
  return { empty: choices.length === 0, select: choices.length > 0 || heldIdUnlisted, heldIdUnlisted };
}
