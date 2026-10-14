// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CalendarLinkEvent } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { buildGoogleCalendarUrl, buildOutlookCalendarUrl } from './calendar-link.util';

const EVENT: CalendarLinkEvent = {
  title: 'Weekly Sync',
  startIso: '2026-01-15T14:00:00Z',
  durationMinutes: 30,
  description: 'Discuss roadmap',
  joinUrl: 'https://zoom.us/j/123',
};

describe('buildGoogleCalendarUrl', () => {
  it('encodes the title, UTC date range, and join link in the details', () => {
    const url = buildGoogleCalendarUrl(EVENT);
    const params = new URL(url).searchParams;

    expect(url.startsWith('https://calendar.google.com/calendar/render?')).toBe(true);
    expect(params.get('text')).toBe('Weekly Sync');
    expect(params.get('dates')).toBe('20260115T140000Z/20260115T143000Z');
    expect(params.get('details')).toContain('Discuss roadmap');
    expect(params.get('details')).toContain('https://zoom.us/j/123');
  });

  it('omits the join link line when joinUrl is not given', () => {
    const url = buildGoogleCalendarUrl({ ...EVENT, joinUrl: undefined });
    const params = new URL(url).searchParams;

    expect(params.get('details')).toBe('Discuss roadmap');
  });
});

describe('buildOutlookCalendarUrl', () => {
  it('encodes the subject, ISO start/end, and join link in the body', () => {
    const url = buildOutlookCalendarUrl(EVENT);
    const params = new URL(url).searchParams;

    expect(url.startsWith('https://outlook.office.com/calendar/0/deeplink/compose?')).toBe(true);
    expect(params.get('subject')).toBe('Weekly Sync');
    expect(params.get('startdt')).toBe('2026-01-15T14:00:00.000Z');
    expect(params.get('enddt')).toBe('2026-01-15T14:30:00.000Z');
    expect(params.get('body')).toContain('https://zoom.us/j/123');
  });
});
