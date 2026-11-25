// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  LINKEDIN_LEAD_FORM_OWNER_MESSAGE,
  LINKEDIN_LEAD_FORMS_ACCESS_UNAVAILABLE_CODE,
  LINKEDIN_LEAD_FORMS_RESTRICTED_MESSAGE,
} from '../constants/campaign.constants';
import type { LinkedInLeadFormsState, LinkedInObjectiveDraft } from '../interfaces/campaign.interface';
import {
  linkedInLeadFormOptions,
  linkedInLeadFormsFailure,
  linkedInLeadFormsMessage,
  linkedInLeadGenCallToActionChoice,
  linkedInLeadGenCreateRefusal,
  linkedInObjectiveDraftWithLeadGenForm,
} from './campaign-linkedin-lead-gen-form.utils';
import {
  emptyLinkedInObjectiveDraft,
  linkedInObjectiveChoice,
  linkedInObjectiveCreateRefusal,
  linkedInObjectiveDraftFromStored,
  linkedInObjectiveFieldsForCreate,
} from './campaign-linkedin-objective-form.utils';

const OWNER = 'tlf|urn:li:sponsoredAccount:111';
const FORM = '6755260984438374400';
const leadGen: LinkedInObjectiveDraft = { ...emptyLinkedInObjectiveDraft(), objective: 'lead_generation', leadGenForm: FORM, leadGenFormOwner: OWNER };
const loaded = (forms: LinkedInLeadFormsState['forms']): LinkedInLeadFormsState => ({ status: 'loaded', forms, failure: null });

describe('linkedInObjectiveFieldsForCreate with lead generation', () => {
  it('sends the objective, form and Register (or the chosen button) only while lead gen is offered, whatever conversions says', () => {
    expect(linkedInObjectiveFieldsForCreate(leadGen, false, true)).toEqual({
      objective: 'lead_generation',
      leadGenForm: FORM,
      leadGenCallToAction: 'REGISTER',
    });
    expect(linkedInObjectiveFieldsForCreate({ ...leadGen, leadGenCallToAction: 'ATTEND' }, true, true)).toMatchObject({ leadGenCallToAction: 'ATTEND' });
    expect(linkedInObjectiveFieldsForCreate(leadGen, true, false)).toEqual({});
    // Another objective never carries a form.
    expect(linkedInObjectiveFieldsForCreate({ ...leadGen, objective: 'traffic' }, true, true)).toEqual({ objective: 'traffic' });
  });
});

describe('linkedInObjectiveCreateRefusal with lead generation', () => {
  const input = { draft: leadGen, available: false, owner: OWNER, leadGenAvailable: true };

  it.each([
    ['nothing for a sendable draft', input, null],
    ['a withdrawn capability', { ...input, leadGenAvailable: false }, 'not available'],
    ['no form', { ...input, draft: { ...leadGen, leadGenForm: undefined } }, 'needs a lead gen form'],
    ['a form picked for another account', { ...input, owner: 'tlf|urn:li:sponsoredAccount:222' }, LINKEDIN_LEAD_FORM_OWNER_MESSAGE],
    ['a manual bid', { ...input, bidding: { strategy: 'manual' as const, bidAmount: 4.5 } }, 'automatic bidding only'],
    ['Text Ads', { ...input, format: 'text' }, 'single image or video'],
  ])('holds %s', (_name, value, expected) => {
    const refusal = linkedInObjectiveCreateRefusal(value);
    if (expected === null) expect(refusal).toBeNull();
    else expect(refusal).toContain(expected);
  });
});

describe('lead gen draft and picker rules', () => {
  it('reads the choice, the button and the picked form with its owner', () => {
    expect(linkedInObjectiveChoice('lead_generation')).toBe('lead_generation');
    expect(linkedInLeadGenCallToActionChoice('UNLOCK_FULL_DOCUMENT')).toBe('UNLOCK_FULL_DOCUMENT');
    expect(linkedInLeadGenCallToActionChoice('bogus')).toBe('REGISTER');
    expect(linkedInObjectiveDraftWithLeadGenForm(emptyLinkedInObjectiveDraft(), FORM, OWNER)).toMatchObject({ leadGenForm: FORM, leadGenFormOwner: OWNER });
    expect(linkedInObjectiveDraftWithLeadGenForm(leadGen, '', OWNER)).not.toHaveProperty('leadGenForm');
    expect(linkedInLeadGenCreateRefusal(leadGen, { available: true, owner: OWNER })).toBeNull();
  });

  it('restores a stored lead gen draft, keeping only text and a known button', () => {
    expect(linkedInObjectiveDraftFromStored({ ...leadGen, leadGenCallToAction: 'ATTEND' })).toMatchObject({
      objective: 'lead_generation',
      leadGenForm: FORM,
      leadGenFormOwner: OWNER,
      leadGenCallToAction: 'ATTEND',
    });
    expect(linkedInObjectiveDraftFromStored({ objective: 'lead_generation', leadGenForm: 7, leadGenCallToAction: 'NOPE' })).toEqual({
      ...emptyLinkedInObjectiveDraft(),
      objective: 'lead_generation',
    });
  });

  it('offers forms with DRAFT marked, and keeps a picked form the read does not list', () => {
    const state = loaded([
      { id: '11', name: 'CFP interest', state: 'PUBLISHED' },
      { id: '12', name: 'Waitlist', state: 'DRAFT' },
    ]);
    expect(linkedInLeadFormOptions(state, '11')).toEqual([
      { value: '11', label: 'CFP interest' },
      { value: '12', label: 'Waitlist (draft)' },
    ]);
    expect(linkedInLeadFormOptions(state, '99')[0]).toEqual({ value: '99', label: 'Form 99' });
  });

  it('says why there is nothing to pick', () => {
    expect(linkedInLeadFormsMessage(loaded([{ id: '11', name: 'CFP', state: 'PUBLISHED' }]))).toBeNull();
    expect(linkedInLeadFormsMessage(loaded([]))).toContain('No lead gen forms');
    expect(linkedInLeadFormsFailure(403, undefined)).toEqual({ status: 'restricted', forms: [], failure: LINKEDIN_LEAD_FORMS_RESTRICTED_MESSAGE });
    expect(linkedInLeadFormsFailure(503, LINKEDIN_LEAD_FORMS_ACCESS_UNAVAILABLE_CODE).failure).toContain('could not be verified');
    expect(linkedInLeadFormsFailure(500, undefined).failure).toContain("didn't load");
  });
});
