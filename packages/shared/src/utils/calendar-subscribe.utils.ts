// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CalendarSubscribeUrls } from '../interfaces/calendar.interface';

/** The feed URL with its `http(s)://` scheme swapped for `webcal://`, which hands it to the OS calendar app. */
export function toWebcalUrl(url: string): string {
  return url.replace(/^https?:\/\//i, 'webcal://');
}

/** Public iCal feed of a project's meetings (a foundation's includes its sub-projects'), served from `baseUrl`. */
export function getProjectCalendarFeedUrl(baseUrl: string, projectUid: string): string {
  return `${baseUrl}/public/api/projects/${encodeURIComponent(projectUid)}/calendar.ics`;
}

/** Path of a project's public calendar page, which anyone can open without signing in. */
export function getPublicProjectCalendarPath(slug: string): string {
  return `/projects/${encodeURIComponent(slug)}/calendar`;
}

/** Links that add the feed to Google Calendar, Outlook.com and Outlook 365 under `name`, and the `webcal://` link for Apple Calendar. */
export function getCalendarSubscribeUrls(feedUrl: string, name: string): CalendarSubscribeUrls {
  return {
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(toWebcalUrl(feedUrl))}`,
    outlookLive: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${encodeURIComponent(name)}`,
    outlook365: `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${encodeURIComponent(name)}`,
    apple: toWebcalUrl(feedUrl),
  };
}
