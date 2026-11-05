// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ORG_EVENTS_ATTRIBUTION,
  DEFAULT_ORG_EVENTS_PARTICIPATION,
  ORG_EVENTS_ATTRIBUTION_OPTIONS,
  ORG_EVENTS_PARTICIPATION_OPTIONS,
} from '../constants/org-events-filters.constants';
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
    expect(parseOrgEventsParticipation('all')).toBe('all');
    expect(parseOrgEventsScope('all')).toBe('all');
    expect(parseOrgEventsAttribution('roster')).toBeNull();
    expect(parseOrgEventsParticipation('')).toBeNull();
    expect(parseOrgEventsScope(undefined)).toBeNull();
  });
});

describe('Events filter defaults', () => {
  it('count everyone related to the company who registered or attended', () => {
    expect(DEFAULT_ORG_EVENTS_PARTICIPATION).toBe('all');
    expect(DEFAULT_ORG_EVENTS_ATTRIBUTION).toBe('all');
    expect(ORG_EVENTS_PARTICIPATION_OPTIONS[0]).toEqual({ label: 'All', value: 'all' });
    expect(ORG_EVENTS_ATTRIBUTION_OPTIONS[0]).toEqual({ label: 'All relations', value: 'all' });
  });
});

describe('Events filter URL params', () => {
  it('drops each default and keeps every other value', () => {
    expect(orgEventsAttributionUrlParam('all')).toBeNull();
    expect(orgEventsAttributionUrlParam('company_email')).toBe('company_email');
    expect(orgEventsAttributionUrlParam('account')).toBe('account');
    expect(orgEventsParticipationUrlParam('all')).toBeNull();
    expect(orgEventsParticipationUrlParam('registered')).toBe('registered');
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
    expect(effectiveOrgEventsParticipation('all', false)).toBe('registered');
    expect(effectiveOrgEventsParticipation('all', true)).toBe('all');
    expect(effectiveOrgEventsParticipation('attended', true)).toBe('attended');
    expect(effectiveOrgEventsParticipation('registered', true)).toBe('registered');
  });
});
