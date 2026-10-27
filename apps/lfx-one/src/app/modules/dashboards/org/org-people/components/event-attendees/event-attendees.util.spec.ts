// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgEventAttendeeDetailRow } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { filterEndedEventsInRange } from './event-attendees.util';

const NOW = new Date('2026-10-27T15:00:00.000Z');

function row(eventId: string, eventEndDate: string | null, isPastEvent = true): OrgEventAttendeeDetailRow {
  return {
    personKey: 'person-one',
    eventId,
    eventName: eventId,
    eventLocation: null,
    eventCity: null,
    eventCountry: null,
    eventUrl: null,
    foundationId: null,
    foundationName: null,
    eventStartDate: eventEndDate,
    eventEndDate,
    isSpeaker: false,
    isPastEvent,
  };
}

const DETAILS = [
  row('upcoming', '2026-12-01', false),
  row('ends-today', '2026-10-27', false),
  row('ended-yesterday', '2026-10-26'),
  row('day-30', '2026-09-27'),
  row('day-31', '2026-09-26'),
  row('day-365', '2025-10-27'),
  row('day-366', '2025-10-26'),
  row('long-ago', '2019-05-01'),
  row('no-end-date', null),
];

const ids = (range: Parameters<typeof filterEndedEventsInRange>[1]) => filterEndedEventsInRange(DETAILS, range, NOW).map((detail) => detail.eventId);

describe('filterEndedEventsInRange', () => {
  it.each(['30d', '90d', '365d', 'all'] as const)('never counts an event that has not ended for %s', (range) => {
    expect(ids(range)).not.toContain('upcoming');
    expect(ids(range)).not.toContain('ends-today');
    expect(ids(range)).not.toContain('no-end-date');
  });

  it('counts events that ended on or after the first day of a bounded range', () => {
    expect(ids('30d')).toEqual(['ended-yesterday', 'day-30']);
    expect(ids('365d')).toEqual(['ended-yesterday', 'day-30', 'day-31', 'day-365']);
  });

  it('counts every ended event for all time', () => {
    expect(ids('all')).toEqual(['ended-yesterday', 'day-30', 'day-31', 'day-365', 'day-366', 'long-ago']);
  });

  // The warehouse flag is as old as the last build; a stale flag must not count an event that ends today.
  it('decides ended-ness against today, not the warehouse flag', () => {
    expect(filterEndedEventsInRange([row('stale-flag', '2026-10-27', true)], 'all', NOW)).toEqual([]);
  });
});
