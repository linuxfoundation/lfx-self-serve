// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { hasMetaLeadFormKeyVariant, metaLeadFormId, metaLeadFormRefusal } from './campaign-meta-lead-form.utils';

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
