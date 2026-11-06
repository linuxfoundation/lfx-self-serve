// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { GOOGLE_DEMAND_GEN_AUDIENCE_BESIDE_AD_GROUPS } from '../constants/campaign.constants';
import {
  googleDemandGenAudienceCarried,
  googleDemandGenAudienceRefusal,
  googleDemandGenAudiencesRefusal,
  googleDemandGenAudienceTypeRefusal,
} from './campaign-google-demand-gen-audience.utils';

const OWNER = 'The Demand Gen audience';
const AUDIENCE = 'customers/1234567890/audiences/42';

describe('googleDemandGenAudienceRefusal', () => {
  it('asks nothing of an absent or empty value', () => {
    for (const value of [undefined, null, '']) expect(googleDemandGenAudienceRefusal(OWNER, value)).toBeNull();
  });

  it('takes a full Audience resource name, trimmed as Go trims', () => {
    expect(googleDemandGenAudienceRefusal(OWNER, AUDIENCE)).toBeNull();
    expect(googleDemandGenAudienceRefusal(OWNER, ` ${AUDIENCE}\u0085`)).toBeNull();
    expect(googleDemandGenAudienceRefusal(OWNER, AUDIENCE, '1234567890')).toBeNull();
  });

  it('refuses a value that is not a string', () => {
    expect(googleDemandGenAudienceRefusal(OWNER, 42)).toBe('The Demand Gen audience must be a Google Ads Audience resource name.');
  });

  it('refuses a blank value', () => {
    expect(googleDemandGenAudienceRefusal(OWNER, '  ')).toBe('The Demand Gen audience must not be blank. Remove it, or pick an Audience.');
  });

  it('refuses every other shape, and an id that is not canonical, without echoing it', () => {
    for (const value of [
      'customers/1234567890/userLists/42',
      'customers/1234567890/audiences/',
      'customers/123-456-7890/audiences/42',
      'customers/1234567890/audiences/0',
      'customers/1234567890/audiences/042',
      'customers/1234567890/audiences/9223372036854775808',
      '42',
    ]) {
      const refusal = googleDemandGenAudienceRefusal(OWNER, value);
      expect(refusal).toContain('is not a Google Ads Audience resource name');
      expect(refusal).not.toContain(value);
    }
  });

  it("refuses another account's Audience when the account is known, and judges the shape only when it is not", () => {
    expect(googleDemandGenAudienceRefusal(OWNER, 'customers/999/audiences/42', '1234567890')).toContain('belongs to another Google Ads account');
    expect(googleDemandGenAudienceRefusal(OWNER, 'customers/999/audiences/42')).toBeNull();
  });
});

describe('googleDemandGenAudiencesRefusal', () => {
  it('refuses the single ad group audience beside named ad groups first, whitespace included', () => {
    expect(googleDemandGenAudiencesRefusal(AUDIENCE, [{ audience: 'nope' }])).toBe(GOOGLE_DEMAND_GEN_AUDIENCE_BESIDE_AD_GROUPS);
    expect(googleDemandGenAudiencesRefusal(' ', [])).toBe(GOOGLE_DEMAND_GEN_AUDIENCE_BESIDE_AD_GROUPS);
    expect(googleDemandGenAudiencesRefusal('', [{ audience: AUDIENCE }])).toBeNull();
  });

  it('names a group by its position', () => {
    expect(googleDemandGenAudiencesRefusal(undefined, [{ audience: AUDIENCE }, { audience: 'bad' }])).toBe(
      'The audience of Demand Gen ad group 2 is not a Google Ads Audience resource name (customers/<id>/audiences/<id>). Remove it and pick an Audience.'
    );
    expect(googleDemandGenAudiencesRefusal(undefined, [{ name: 'Retargeting' }, null, { audience: AUDIENCE }])).toBeNull();
  });

  it('judges the single ad group audience, and the account, when not split', () => {
    expect(googleDemandGenAudiencesRefusal('customers/7/audiences/1', undefined, '1234567890')).toContain('The Demand Gen audience belongs to another');
  });
});

describe('googleDemandGenAudienceCarried', () => {
  it('counts any value but undefined, null or an empty string, on either field', () => {
    expect(googleDemandGenAudienceCarried(undefined, undefined)).toBe(false);
    expect(googleDemandGenAudienceCarried('', [{ audience: '' }, { audience: null }, null, 'x'])).toBe(false);
    expect(googleDemandGenAudienceCarried(' ', undefined)).toBe(true);
    expect(googleDemandGenAudienceCarried(0, undefined)).toBe(true);
    expect(googleDemandGenAudienceCarried(undefined, [{ name: 'a' }, { audience: 'x' }])).toBe(true);
  });
});

describe('googleDemandGenAudienceTypeRefusal', () => {
  it('passes absent, null, an empty list and every string, blank and malformed included, to the checks after it', () => {
    for (const value of [undefined, null, [], '', '  ', 'nope', AUDIENCE]) {
      expect(googleDemandGenAudienceTypeRefusal(value, [{ name: 'a', audience: value }])).toBeNull();
    }
    expect(googleDemandGenAudienceTypeRefusal(undefined, 'not a list')).toBeNull();
    expect(googleDemandGenAudienceTypeRefusal(undefined, [null, 7, { name: 'a' }])).toBeNull();
  });

  it.each([[42], [['x']], [{}], [false]])('refuses a single ad group audience of %j', (value) => {
    expect(googleDemandGenAudienceTypeRefusal(value, undefined)).toBe('The Demand Gen audience must be a Google Ads Audience resource name.');
  });

  it("refuses the first group's audience that is not a string, naming the group", () => {
    expect(googleDemandGenAudienceTypeRefusal(AUDIENCE, [{ audience: AUDIENCE }, { audience: 7 }, { audience: ['x'] }])).toBe(
      'The audience of Demand Gen ad group 2 must be a Google Ads Audience resource name.'
    );
  });
});
