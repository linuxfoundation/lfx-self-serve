// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CalendarLinkEvent } from '@lfx-one/shared/interfaces';

function toGoogleDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function buildDetails(event: CalendarLinkEvent): string {
  return event.joinUrl ? `${event.description ?? ''}\n\nJoin: ${event.joinUrl}`.trim() : (event.description ?? '');
}

/** Builds a Google Calendar "add event" deep link — opens pre-filled, the user still clicks Save. */
export function buildGoogleCalendarUrl(event: CalendarLinkEvent): string {
  const start = new Date(event.startIso);
  const end = new Date(start.getTime() + event.durationMinutes * 60_000);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toGoogleDate(start)}/${toGoogleDate(end)}`,
    details: buildDetails(event),
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Builds an Outlook/Microsoft 365 web "compose event" deep link. */
export function buildOutlookCalendarUrl(event: CalendarLinkEvent): string {
  const start = new Date(event.startIso);
  const end = new Date(start.getTime() + event.durationMinutes * 60_000);

  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body: buildDetails(event),
  });

  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}
