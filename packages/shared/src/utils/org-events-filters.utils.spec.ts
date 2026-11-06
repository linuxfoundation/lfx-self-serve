// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ORG_EVENTS_ATTRIBUTION,
  DEFAULT_ORG_EVENTS_PARTICIPATION,
  ORG_EVENTS_ATTRIBUTION_COLUMN_SUFFIX,
  ORG_EVENTS_ATTRIBUTION_OPTIONS,
  ORG_EVENTS_ATTRIBUTION_TOOLTIP,
  ORG_EVENTS_PARTICIPATION_OPTIONS,
} from '../constants/org-events-filters.constants';
import {
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
    expect(parseOrgEventsAttribution('self_reported')).toBe('self_reported');
    expect(parseOrgEventsAttribution('verified')).toBe('verified');
    expect(parseOrgEventsAttribution('all')).toBe('all');
    expect(parseOrgEventsParticipation('attended')).toBe('attended');
    expect(parseOrgEventsParticipation('all')).toBe('all');
    expect(parseOrgEventsScope('all')).toBe('all');
    expect(parseOrgEventsAttribution('roster')).toBeNull();
    expect(parseOrgEventsParticipation('')).toBeNull();
    expect(parseOrgEventsScope(undefined)).toBeNull();
  });

  // lfx-self-serve#5315 retired Company email and Account on registration; old links fall back to the default.
  it('rejects the retired company_email and account values', () => {
    expect(parseOrgEventsAttribution('company_email')).toBeNull();
    expect(parseOrgEventsAttribution('account')).toBeNull();
  });
});

describe('Events filter defaults', () => {
  it('count Employee match people who registered or attended', () => {
    expect(DEFAULT_ORG_EVENTS_PARTICIPATION).toBe('all');
    expect(DEFAULT_ORG_EVENTS_ATTRIBUTION).toBe('verified');
    expect(ORG_EVENTS_PARTICIPATION_OPTIONS[0]).toEqual({ label: 'All', value: 'all' });
  });

  it('offers Employee match, Self-reported only and All, in that order', () => {
    expect(ORG_EVENTS_ATTRIBUTION_OPTIONS).toEqual([
      { label: 'Employee match', value: 'verified' },
      { label: 'Self-reported only', value: 'self_reported' },
      { label: 'All', value: 'all' },
    ]);
    expect(ORG_EVENTS_ATTRIBUTION_COLUMN_SUFFIX).toEqual({ verified: 'VERIFIED', self_reported: 'SELF_REPORTED', all: 'ALL' });
    expect(Object.values(ORG_EVENTS_ATTRIBUTION_TOOLTIP).join(' ')).not.toContain('All Employees');
  });
});

describe('Events filter URL params', () => {
  it('drops each default and keeps every other value', () => {
    expect(orgEventsAttributionUrlParam('verified')).toBeNull();
    expect(orgEventsAttributionUrlParam('all')).toBe('all');
    expect(orgEventsAttributionUrlParam('self_reported')).toBe('self_reported');
    expect(orgEventsParticipationUrlParam('all')).toBeNull();
    expect(orgEventsParticipationUrlParam('registered')).toBe('registered');
    expect(orgEventsParticipationUrlParam('attended')).toBe('attended');
    expect(orgEventsScopeUrlParam('activity')).toBeNull();
    expect(orgEventsScopeUrlParam('all')).toBe('all');
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
