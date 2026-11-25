// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { linkedInConfigNamesLeadGenForm, linkedInLeadForms, linkedInLeadGenFormId, linkedInLeadGenRefusal } from './campaign-linkedin-lead-gen.utils';
import { linkedInObjectiveRefusal } from './campaign-linkedin-objective.utils';

const FORM = '6755260984438374400';
const leadGen = { objective: 'lead_generation', leadGenForm: FORM };

describe('linkedInLeadGenRefusal', () => {
  it.each([
    [{}, true],
    [null, true],
    // None of the three: nothing is checked, whatever the flag.
    [{ objective: 'conversions' }, false],
    // Blank and empty count as omitted, as campaign-service reads them.
    [{ leadGenForm: '  ', leadGenCallToAction: '' }, false],
    // null reads as omitted, as campaign-service's checkLeadGenShape reads it.
    [{ ...leadGen, leadGenCallToAction: null }, true],
    // Go's TrimSpace trims U+0085.
    [{ ...leadGen, leadGenForm: `\u0085${FORM}` }, true],
    [leadGen, true],
    [{ ...leadGen, leadGenForm: `urn:li:adForm:${FORM}`, leadGenCallToAction: 'UNLOCK_FULL_DOCUMENT' }, true],
    [{ ...leadGen, bidding: { strategy: 'automatic' }, format: 'single_image', variants: [{ callToAction: ' ' }] }, true],
  ])('accepts %j (enabled: %s)', (raw, enabled) => {
    expect(linkedInLeadGenRefusal(raw, enabled)).toBeNull();
  });

  it.each([
    [{ leadGenForm: 1 }, true, 'linkedInConfig.leadGenForm'],
    [{ ...leadGen, leadGenCallToAction: 5 }, true, 'linkedInConfig.leadGenCallToAction'],
    // Go's TrimSpace keeps U+FEFF, so this is a form, sent without the objective.
    [{ leadGenForm: '\uFEFF' }, true, 'linkedInConfig.leadGenForm'],
    // Refused, never dropped, while the deployment cannot send them, naming what was set.
    [{ objective: 'lead_generation' }, false, 'linkedInConfig.objective'],
    [leadGen, false, 'linkedInConfig.leadGenForm'],
    [{ leadGenCallToAction: 'REGISTER' }, false, 'linkedInConfig.leadGenCallToAction'],
    [{ objective: 'traffic', leadGenForm: FORM }, true, 'linkedInConfig.leadGenForm'],
    [{ leadGenCallToAction: 'REGISTER' }, true, 'linkedInConfig.leadGenCallToAction'],
    [{ ...leadGen, bidding: { strategy: 'manual', bidAmount: 4 } }, true, 'linkedInConfig.objective'],
    [{ objective: 'lead_generation' }, true, 'linkedInConfig.leadGenForm'],
    [{ ...leadGen, leadGenForm: '0123' }, true, 'linkedInConfig.leadGenForm'],
    [{ ...leadGen, leadGenForm: 'urn:li:adForm:abc' }, true, 'linkedInConfig.leadGenForm'],
    [{ ...leadGen, leadGenCallToAction: 'register' }, true, 'linkedInConfig.leadGenCallToAction'],
    [{ ...leadGen, format: 'text' }, true, 'linkedInConfig.format'],
    [{ ...leadGen, offsiteDeliveryEnabled: true }, true, 'linkedInConfig.offsiteDeliveryEnabled'],
    [{ ...leadGen, variants: [{}, { callToAction: 'LEARN_MORE' }] }, true, 'linkedInConfig.variants[1].callToAction'],
  ])('refuses %j (enabled: %s), naming %s', (raw, enabled, field) => {
    expect(linkedInLeadGenRefusal(raw, enabled)?.field).toBe(field);
  });

  it('never echoes a caller value', () => {
    expect(linkedInLeadGenRefusal({ ...leadGen, leadGenForm: 'secret-form' }, true)?.message).not.toContain('secret-form');
  });

  it('leaves the lead generation objective out of the conversions checks, which still read conversions beside it', () => {
    expect(linkedInObjectiveRefusal(leadGen, false)).toBeNull();
    expect(linkedInObjectiveRefusal({ ...leadGen, conversions: ['104012'] }, false)?.field).toBe('linkedInConfig.conversions');
  });
});

describe('linkedInLeadGenFormId and linkedInConfigNamesLeadGenForm', () => {
  it('reads the bare id from either spelling, and nothing else', () => {
    expect(linkedInLeadGenFormId(` urn:li:adForm:${FORM} `)).toBe(FORM);
    expect(linkedInLeadGenFormId(FORM)).toBe(FORM);
    expect(linkedInLeadGenFormId('urn:li:sponsoredAccount:1')).toBeNull();
    expect(linkedInConfigNamesLeadGenForm({ leadGenForm: ' ' })).toBe(false);
    expect(linkedInConfigNamesLeadGenForm(leadGen)).toBe(true);
  });
});

describe('linkedInLeadForms', () => {
  it('keeps unarchived forms with a valid id, once, named by name or id', () => {
    expect(
      linkedInLeadForms([
        { id: '11', urn: 'urn:li:adForm:11', name: ' CFP interest ', state: 'PUBLISHED' },
        { id: '12', urn: 'urn:li:adForm:12', name: '', state: 'DRAFT' },
        { id: '13', urn: 'urn:li:adForm:13', name: 'Old', state: 'ARCHIVED' },
        { id: '11', name: 'Again', state: 'PUBLISHED' },
        { id: 'x', name: 'Bad id', state: 'PUBLISHED' },
        null,
      ])
    ).toEqual([
      { id: '11', name: 'CFP interest', state: 'PUBLISHED' },
      { id: '12', name: '12', state: 'DRAFT' },
    ]);
    expect(linkedInLeadForms(undefined)).toEqual([]);
  });
});
