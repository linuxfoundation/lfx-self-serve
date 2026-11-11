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
// vi.mock is hoisted above the static imports, so these factories load the real modules with dynamic imports.
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
      participation: 'all',
      scope: 'activity',
      foundation: '',
      range: '730d',
    });
  });

  it('reads each param', () => {
    const filters = parseOrgEventsFilters(buildReq({ participation: 'attended', eventScope: 'all', foundation: 'foundation-one', range: '90d' }), 'op');

    expect(filters).toEqual({ participation: 'attended', scope: 'all', foundation: 'foundation-one', range: '90d' });
  });

  it('ignores a legacy attribution param', () => {
    const filters = parseOrgEventsFilters(buildReq({ attribution: 'self_reported' }), 'op');

    expect(filters).not.toHaveProperty('attribution');
  });

  it.each([
    ['participation', { participation: 'maybe' }],
    ['eventScope', { eventScope: 'some' }],
    ['range', { range: '5d' }],
    ['foundation', { foundation: 'x'.repeat(129) }],
  ])('rejects an unknown %s with a 400', (_field, query) => {
    expect(() => parseOrgEventsFilters(buildReq(query), 'op')).toThrow(ServiceValidationError);
  });
});

describe('SQL fragments', () => {
  it('derives the ORG_EVENTS count columns from the participation', () => {
    expect(orgEventsCountColumn('registered')).toBe('REGISTERED_COUNT_VERIFIED');
    expect(orgEventsCountColumn('attended')).toBe('ATTENDED_COUNT_VERIFIED');
    expect(orgEventsCountColumn('all')).toBe('ALL_COUNT_VERIFIED');
    expect(orgEventsFootprintColumn()).toBe('HAS_FOOTPRINT_VERIFIED');
  });

  it('builds the attendee predicate as the one dbt conjunction flag of the participation', () => {
    expect(orgEventsAttendeePredicate('registered')).toBe('IS_COUNTED_REGISTERED_VERIFIED = TRUE');
    expect(orgEventsAttendeePredicate('attended')).toBe('IS_COUNTED_ATTENDED_VERIFIED = TRUE');
    expect(orgEventsAttendeePredicate('all')).toBe('IS_COUNTED_ALL_VERIFIED = TRUE');
  });

  it('builds the speaker predicate as the one dbt conjunction flag', () => {
    expect(orgEventsSpeakerPredicate()).toBe('IS_COUNTED_SPEAKER_VERIFIED = TRUE');
  });

  it('windows a bounded range inline and leaves all time open', () => {
    expect(orgEventsRangeWindow('EVENT_DATE', '90d')).toBe('AND EVENT_DATE >= DATEADD(day, -90, CURRENT_DATE())');
    expect(orgEventsRangeWindow('EVENT_DATE', 'all')).toBe('');
  });
});
