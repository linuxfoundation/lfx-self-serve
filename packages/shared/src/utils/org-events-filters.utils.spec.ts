// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { DEFAULT_ORG_EVENTS_PARTICIPATION, ORG_EVENTS_PARTICIPATION_OPTIONS } from '../constants/org-events-filters.constants';
import {
  effectiveOrgEventsParticipation,
  orgEventsParticipationUrlParam,
  orgEventsScopeUrlParam,
  parseOrgEventsParticipation,
  parseOrgEventsScope,
} from './org-events-filters.utils';

// lfx-self-serve#4598 — one set of Events filters on every Events surface.
describe('Events filter parsing', () => {
  it('reads each allowed value and rejects anything else', () => {
    expect(parseOrgEventsParticipation('attended')).toBe('attended');
    expect(parseOrgEventsParticipation('all')).toBe('all');
    expect(parseOrgEventsScope('all')).toBe('all');
    expect(parseOrgEventsParticipation('')).toBeNull();
    expect(parseOrgEventsScope(undefined)).toBeNull();
  });
});

describe('Events filter defaults', () => {
  it('count registered or attended people, and offers Count in that order', () => {
    expect(DEFAULT_ORG_EVENTS_PARTICIPATION).toBe('all');
    expect(ORG_EVENTS_PARTICIPATION_OPTIONS[0]).toEqual({ label: 'All', value: 'all' });
  });
});

describe('Events filter URL params', () => {
  it('drops each default and keeps every other value', () => {
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
