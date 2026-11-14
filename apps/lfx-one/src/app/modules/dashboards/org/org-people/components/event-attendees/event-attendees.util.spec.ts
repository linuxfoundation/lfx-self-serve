// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgEventAttendeeDetailRow } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { eventDateOf } from './event-attendees.util';

function row(eventEndDate: string | null, eventStartDate: string | null): OrgEventAttendeeDetailRow {
  return {
    participantRef: 1,
    personKey: 'person-one',
    displayName: 'Ada Lovelace',
    jobTitle: null,
    eventId: 'event-one',
    eventName: 'event-one',
    eventLocation: null,
    eventCity: null,
    eventCountry: null,
    eventUrl: null,
    foundationId: null,
    foundationName: null,
    eventStartDate,
    eventEndDate,
    isSpeaker: false,
  };
}

describe('eventDateOf', () => {
  it('dates an event by its end date', () => {
    expect(eventDateOf(row('2026-10-02', '2026-10-01'))).toBe('2026-10-02');
  });

  it('falls back to the start date when the event has no end date', () => {
    expect(eventDateOf(row(null, '2026-10-01'))).toBe('2026-10-01');
  });

  it('is null when the event has neither date', () => {
    expect(eventDateOf(row(null, null))).toBeNull();
  });
});
