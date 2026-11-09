// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

// The real validation helper pulls constants and utils barrels that do not load in this server-only environment;
// only the query-string reader is needed here.
vi.mock('./validation.helper', () => ({
  getStringQueryParam: (req: Request, name: string): string | undefined => {
    const value = req.query[name];
    return typeof value === 'string' ? value : undefined;
  },
}));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await import('../../../../../packages/shared/src/constants/org-events-filters.constants')),
  ...(await import('../../../../../packages/shared/src/constants/org-lens-time-range.constants')),
}));
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-events-filters.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
}));

import { ServiceValidationError } from '../errors';
import {
  orgEventsAttendeePredicate,
  orgEventsCountColumn,
  orgEventsFootprintColumn,
  orgEventsRangeWindow,
  orgEventsSpeakerPredicate,
  parseOrgEventsFilters,
} from './org-events-filters.helper';

function buildReq(query: Record<string, unknown>): Request {
  return { query } as unknown as Request;
}

describe('parseOrgEventsFilters', () => {
  it('defaults every missing param', () => {
    expect(parseOrgEventsFilters(buildReq({}), 'op')).toEqual({
      attribution: 'verified',
      participation: 'all',
      scope: 'activity',
      foundation: '',
      range: '730d',
    });
  });

  it('reads each param', () => {
    const filters = parseOrgEventsFilters(
      buildReq({ attribution: 'self_reported', participation: 'attended', eventScope: 'all', foundation: 'foundation-one', range: '90d' }),
      'op'
    );

    expect(filters).toEqual({ attribution: 'self_reported', participation: 'attended', scope: 'all', foundation: 'foundation-one', range: '90d' });
  });

  it('reads the registered or attended participation', () => {
    expect(parseOrgEventsFilters(buildReq({ participation: 'all' }), 'op').participation).toBe('all');
    expect(parseOrgEventsFilters(buildReq({ participation: 'registered' }), 'op').participation).toBe('registered');
  });

  it.each([
    ['attribution', { attribution: 'everyone' }],
    ['attribution', { attribution: 'company_email' }],
    ['attribution', { attribution: 'account' }],
    ['participation', { participation: 'maybe' }],
    ['eventScope', { eventScope: 'some' }],
    ['range', { range: '5d' }],
    ['foundation', { foundation: 'x'.repeat(129) }],
  ])('rejects an unknown %s with a 400', (_field, query) => {
    expect(() => parseOrgEventsFilters(buildReq(query), 'op')).toThrow(ServiceValidationError);
  });
});

describe('SQL fragments', () => {
  it('derives the ORG_EVENTS columns from the typed option', () => {
    expect(orgEventsCountColumn('verified', 'registered')).toBe('REGISTERED_COUNT_VERIFIED');
    expect(orgEventsCountColumn('self_reported', 'attended')).toBe('ATTENDED_COUNT_SELF_REPORTED');
    expect(orgEventsCountColumn('all', 'registered')).toBe('REGISTERED_COUNT_ALL');
    expect(orgEventsCountColumn('self_reported', 'all')).toBe('ALL_COUNT_SELF_REPORTED');
    expect(orgEventsCountColumn('all', 'all')).toBe('ALL_COUNT_ALL');
    expect(orgEventsFootprintColumn('all')).toBe('HAS_FOOTPRINT_ALL');
    expect(orgEventsFootprintColumn('self_reported')).toBe('HAS_FOOTPRINT_SELF_REPORTED');
  });

  it('builds the attendee predicate as the one dbt conjunction flag of the pair', () => {
    expect(orgEventsAttendeePredicate('verified', 'registered')).toBe('IS_COUNTED_REGISTERED_VERIFIED = TRUE');
    expect(orgEventsAttendeePredicate('self_reported', 'attended')).toBe('IS_COUNTED_ATTENDED_SELF_REPORTED = TRUE');
    expect(orgEventsAttendeePredicate('all', 'registered')).toBe('IS_COUNTED_REGISTERED_ALL = TRUE');
    expect(orgEventsAttendeePredicate('self_reported', 'all')).toBe('IS_COUNTED_ALL_SELF_REPORTED = TRUE');
    expect(orgEventsAttendeePredicate('all', 'all')).toBe('IS_COUNTED_ALL_ALL = TRUE');
  });

  it('builds the speaker predicate as the one dbt conjunction flag of the attribution', () => {
    expect(orgEventsSpeakerPredicate('verified')).toBe('IS_COUNTED_SPEAKER_VERIFIED = TRUE');
    expect(orgEventsSpeakerPredicate('self_reported')).toBe('IS_COUNTED_SPEAKER_SELF_REPORTED = TRUE');
    expect(orgEventsSpeakerPredicate('all')).toBe('IS_COUNTED_SPEAKER_ALL = TRUE');
  });

  it('windows a bounded range inline and leaves all time open', () => {
    expect(orgEventsRangeWindow('EVENT_DATE', '90d')).toBe('AND EVENT_DATE >= DATEADD(day, -90, CURRENT_DATE())');
    expect(orgEventsRangeWindow('EVENT_DATE', 'all')).toBe('');
  });
});
