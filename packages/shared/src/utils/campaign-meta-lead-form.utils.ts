// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_META_OBJECTIVE, META_LEAD_FORM_CALL_TO_ACTIONS, META_LEAD_FORM_ID_PATTERN } from '../constants/campaign.constants';
import type { MetaConfigRefusal } from '../interfaces/campaign.interface';
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
