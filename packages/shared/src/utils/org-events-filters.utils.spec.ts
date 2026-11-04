// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  effectiveOrgEventsAttribution,
  effectiveOrgEventsParticipation,
  orgEventsAttributionUrlParam,
  orgEventsParticipationUrlParam,
  orgEventsScopeUrlParam,
  parseOrgEventsAttribution,
  parseOrgEventsParticipation,
  parseOrgEventsScope,
} from './org-events-filters.utils';

// lfx-self-serve#4598 — one set of Events filters on every Events surface.
describe('Events filter parsing', () => {
  it('reads each allowed value and rejects anything else', () => {
    expect(parseOrgEventsAttribution('account')).toBe('account');
    expect(parseOrgEventsParticipation('attended')).toBe('attended');
    expect(parseOrgEventsScope('all')).toBe('all');
    expect(parseOrgEventsAttribution('roster')).toBeNull();
    expect(parseOrgEventsParticipation('')).toBeNull();
    expect(parseOrgEventsScope(undefined)).toBeNull();
  });
});

describe('Events filter URL params', () => {
  it('drops each default and keeps every other value', () => {
    expect(orgEventsAttributionUrlParam('company_email')).toBeNull();
    expect(orgEventsAttributionUrlParam('all')).toBe('all');
    expect(orgEventsParticipationUrlParam('registered')).toBeNull();
    expect(orgEventsParticipationUrlParam('attended')).toBe('attended');
    expect(orgEventsScopeUrlParam('activity')).toBeNull();
    expect(orgEventsScopeUrlParam('all')).toBe('all');
  });
});

describe('effectiveOrgEventsAttribution', () => {
  it('serves Account on registration instead of zeros when the company has no company-email data', () => {
    expect(effectiveOrgEventsAttribution('company_email', false)).toBe('account');
    expect(effectiveOrgEventsAttribution('company_email', true)).toBe('company_email');
  });

  it('leaves the other picks alone whatever the coverage', () => {
    expect(effectiveOrgEventsAttribution('account', false)).toBe('account');
    expect(effectiveOrgEventsAttribution('all', false)).toBe('all');
  });
});

describe('effectiveOrgEventsParticipation', () => {
  it('counts registrations on the Upcoming tab, where nobody has attended', () => {
    expect(effectiveOrgEventsParticipation('attended', false)).toBe('registered');
    expect(effectiveOrgEventsParticipation('attended', true)).toBe('attended');
    expect(effectiveOrgEventsParticipation('registered', true)).toBe('registered');
  });
});
