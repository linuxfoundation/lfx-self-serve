// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { META_LEAD_FORM_INACTIVE_REFUSAL } from '../constants/campaign.constants';
import type { MetaLeadFormPickerState } from '../interfaces/campaign.interface';

import {
  hasMetaLeadFormKeyVariant,
  metaCallToActionAllowedWithLeadForm,
  metaFoundationChange,
  metaHeldLeadFormRefusal,
  metaLeadFormChoices,
  metaLeadFormDraftRefusal,
  metaLeadFormForObjective,
  metaLeadFormId,
  metaLeadFormPickerView,
  metaLeadFormRefusal,
  metaLeadFormRestore,
  metaObjectiveAfterFoundationSwitch,
  metaObjectiveChoices,
} from './campaign-meta-lead-form.utils';

describe('metaLeadFormRefusal', () => {
  it.each([
    ['no form', { objective: 'traffic' }, false],
    ['a null form', { leadFormId: null, objective: 'traffic' }, true],
    ['a blank form ("Not set")', { leadFormId: '  ', objective: 'awareness' }, false],
    ['a form on leads', { leadFormId: '1234567890123456', objective: 'leads' }, false],
    ['a form on LEADS, any case', { leadFormId: ' 1234567890123456 ', objective: ' LEADS ' }, false],
    ['a form with a call to action it can carry', { leadFormId: '1', objective: 'leads', callToAction: 'sign_up' }, false],
    ['a non-object body', 'leads', false],
  ])('accepts %s', (_label, raw, manual) => {
    expect(metaLeadFormRefusal(raw, manual)).toBeNull();
  });

  it.each([
    ['a non-string id', { leadFormId: 1234, objective: 'leads' }, false, 'metaConfig.leadFormId'],
    ['an id that is not digits', { leadFormId: 'form-1', objective: 'leads' }, false, 'metaConfig.leadFormId'],
    ['an id over 20 digits', { leadFormId: '1'.repeat(21), objective: 'leads' }, false, 'metaConfig.leadFormId'],
    ['a form off leads', { leadFormId: '1', objective: 'conversions' }, false, 'metaConfig.leadFormId'],
    ['a form with no objective (traffic)', { leadFormId: '1' }, false, 'metaConfig.leadFormId'],
    ['a form with manual bidding', { leadFormId: '1', objective: 'leads' }, true, 'metaConfig.leadFormId'],
    ['a call to action a form cannot carry', { leadFormId: '1', objective: 'leads', callToAction: 'BUY_TICKETS' }, false, 'metaConfig.callToAction'],
  ])('refuses %s', (_label, raw, manual, field) => {
    expect(metaLeadFormRefusal(raw, manual)?.field).toBe(field);
  });

  it('names the calls to action a form can carry', () => {
    expect(metaLeadFormRefusal({ leadFormId: '1', objective: 'leads', callToAction: 'BOOK_NOW' }, false)?.message).toBe(
      'With a lead form, the call to action must be one of Learn more, Sign up, Apply now, Subscribe, Download.'
    );
  });
});

describe('metaLeadFormId', () => {
  it.each([
    [{ leadFormId: ' 42 ' }, '42'],
    [{ leadFormId: '' }, null],
    [{ leadFormId: null }, null],
    [{}, null],
    [{ leadFormId: 42 }, null],
    [undefined, null],
  ])('reads %j as %j', (raw, expected) => {
    expect(metaLeadFormId(raw)).toBe(expected);
  });
});

describe('hasMetaLeadFormKeyVariant', () => {
  it('flags any other spelling of leadFormId, and nothing else', () => {
    expect(hasMetaLeadFormKeyVariant({ LeadFormId: '1' })).toBe(true);
    expect(hasMetaLeadFormKeyVariant({ leadformid: '1', leadFormId: '1' })).toBe(true);
    expect(hasMetaLeadFormKeyVariant({ leadFormId: '1' })).toBe(false);
    expect(hasMetaLeadFormKeyVariant({ objective: 'leads' })).toBe(false);
    expect(hasMetaLeadFormKeyVariant(undefined)).toBe(false);
  });
});

describe('metaObjectiveChoices', () => {
  it('hides leads unless lead forms are enabled', () => {
    expect(metaObjectiveChoices(false)).toEqual(['awareness', 'traffic', 'engagement', 'conversions']);
    expect(metaObjectiveChoices(true)).toEqual(['awareness', 'traffic', 'engagement', 'leads', 'conversions']);
  });
});

describe('metaLeadFormChoices', () => {
  it('lets only an ACTIVE form with a valid id be picked, and shows the others with their status', () => {
    expect(
      metaLeadFormChoices([
        { id: '111', name: 'Registrations', status: 'ACTIVE' },
        { id: '222', name: 'Old form', status: 'ARCHIVED' },
        { id: 'not-digits', name: 'Odd id', status: 'active' },
        { id: '333', name: 'No status', status: ' ' },
      ])
    ).toEqual([
      { value: '111', label: 'Registrations', disabled: false },
      { value: '222', label: 'Old form (archived)', disabled: true },
      { value: 'not-digits', label: 'Odd id (active)', disabled: true },
      { value: '333', label: 'No status (unknown)', disabled: true },
    ]);
  });
});

describe('metaLeadFormForObjective', () => {
  it('keeps the form only on leads', () => {
    expect(metaLeadFormForObjective('leads', '111')).toBe('111');
    expect(metaLeadFormForObjective('traffic', '111')).toBe('');
  });
});

describe('metaCallToActionAllowedWithLeadForm', () => {
  it.each([
    ['SIGN_UP', true, true],
    [' learn_more ', true, true],
    ['BUY_TICKETS', true, false],
    ['BUY_TICKETS', false, true],
  ])('%s with a lead form %s -> %s', (cta, withForm, allowed) => {
    expect(metaCallToActionAllowedWithLeadForm(cta, withForm)).toBe(allowed);
  });
});

describe('metaLeadFormDraftRefusal', () => {
  const draft = { leadFormsEnabled: true, objective: 'leads' as const, leadFormId: '111', manualBidding: false };

  it.each([
    ['lead forms off, on another objective', { ...draft, leadFormsEnabled: false, objective: 'traffic' as const, leadFormId: '' }],
    ['another objective', { ...draft, objective: 'traffic' as const, leadFormId: '' }],
    ['a form on leads', draft],
    ['a form with a call to action it can carry', { ...draft, callToAction: 'SIGN_UP' }],
  ])('accepts %s', (_label, value) => {
    expect(metaLeadFormDraftRefusal(value)).toBeNull();
  });

  it.each([
    ['leads with no form', { ...draft, leadFormId: '  ' }, 'metaConfig.leadFormId'],
    ['a form held while lead forms are off', { ...draft, leadFormsEnabled: false }, 'metaConfig.leadFormId'],
    ['leads without a form while lead forms are off (never sent as traffic)', { ...draft, leadFormsEnabled: false, leadFormId: '' }, 'metaConfig.leadFormId'],
    ['a typed id that is not digits', { ...draft, leadFormId: 'abc' }, 'metaConfig.leadFormId'],
    ['manual bidding', { ...draft, manualBidding: true }, 'metaConfig.leadFormId'],
    ['a call to action a form cannot carry', { ...draft, callToAction: 'BUY_TICKETS' }, 'metaConfig.callToAction'],
  ])('refuses %s', (_label, value, field) => {
    expect(metaLeadFormDraftRefusal(value)?.field).toBe(field);
  });
});

describe('metaObjectiveAfterFoundationSwitch', () => {
  it('drops leads to the default and keeps every other objective', () => {
    expect(metaObjectiveAfterFoundationSwitch('leads')).toBe('traffic');
    expect(metaObjectiveAfterFoundationSwitch('conversions')).toBe('conversions');
  });
});

describe('metaLeadFormRestore', () => {
  it('restores the form only under the foundation it was picked under, and only on leads', () => {
    expect(metaLeadFormRestore({ objective: 'leads', leadFormId: '111', project: 'tlf' }, 'tlf')).toEqual({ objective: 'leads', leadFormId: '111' });
    expect(metaLeadFormRestore({ objective: 'traffic', leadFormId: '111', project: 'tlf' }, 'tlf')).toEqual({ objective: 'traffic', leadFormId: '' });
  });

  it('drops leads and the form when the draft was saved under another foundation', () => {
    expect(metaLeadFormRestore({ objective: 'leads', leadFormId: '111', project: 'tlf' }, 'cncf')).toEqual({ objective: 'traffic', leadFormId: '' });
    expect(metaLeadFormRestore({ objective: 'conversions', leadFormId: '', project: 'tlf' }, 'cncf')).toEqual({ objective: 'conversions', leadFormId: '' });
  });

  it('changes nothing for a draft without a saved form, or while the foundation is unknown', () => {
    expect(metaLeadFormRestore({ objective: 'leads' }, 'cncf')).toEqual({ objective: 'leads', leadFormId: null });
    expect(metaLeadFormRestore({ objective: 'leads', leadFormId: '111', project: 'tlf' }, '')).toEqual({ objective: 'leads', leadFormId: null });
  });
});

describe('metaLeadFormPickerView', () => {
  const choices = [{ value: '111', label: 'Registrations', disabled: false }];

  it('shows the select for listed forms, with a held id the list does not show as its own option', () => {
    expect(metaLeadFormPickerView(choices, '')).toEqual({ empty: false, select: true, heldIdUnlisted: false });
    expect(metaLeadFormPickerView(choices, '111')).toEqual({ empty: false, select: true, heldIdUnlisted: false });
    expect(metaLeadFormPickerView(choices, '999')).toEqual({ empty: false, select: true, heldIdUnlisted: true });
  });

  it('keeps a held id visible when the Page has no forms, and shows only the empty text otherwise', () => {
    expect(metaLeadFormPickerView([], '999')).toEqual({ empty: true, select: true, heldIdUnlisted: true });
    expect(metaLeadFormPickerView([], '')).toEqual({ empty: true, select: false, heldIdUnlisted: false });
  });
});

describe('metaHeldLeadFormRefusal', () => {
  const loaded = (choices: MetaLeadFormPickerState['choices']): MetaLeadFormPickerState => ({ status: 'loaded', choices, reason: null });
  const active = { value: '1234567890123456', label: 'KubeCon NA interest', disabled: false };
  const archived = { value: '2234567890123456', label: 'Old form (archived)', disabled: true };

  it.each([
    // A held form the list shows as not active cannot be sent.
    [loaded([active, archived]), '2234567890123456', META_LEAD_FORM_INACTIVE_REFUSAL],
    // An active one, none held, or one the list does not show at all: nothing to say here.
    [loaded([active, archived]), '1234567890123456', null],
    [loaded([active, archived]), '', null],
    [loaded([active]), '9234567890123456', null],
    // Nothing is known until the list has loaded.
    [{ status: 'loading', choices: [], reason: null }, '2234567890123456', null],
    [{ status: 'unavailable', choices: [], reason: 'x' }, '2234567890123456', null],
  ] as [MetaLeadFormPickerState, string, string | null][])('%j holding %j: %j', (picker, heldId, expected) => {
    expect(metaHeldLeadFormRefusal(picker, heldId)).toBe(expected);
  });
});

describe('metaFoundationChange', () => {
  it.each([
    ['', 'tlf', 'resolved'],
    ['tlf', 'cncf', 'switched'],
    ['tlf', '', 'switched'],
    ['tlf', 'tlf', 'same'],
    ['', '', 'same'],
  ])('%j to %j is %s', (previous, next, expected) => {
    expect(metaFoundationChange(previous, next)).toBe(expected);
  });
});
