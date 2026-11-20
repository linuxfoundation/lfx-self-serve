// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { getCalendarSubscribeUrls, getProjectCalendarFeedUrl, getPublicProjectCalendarPath, toWebcalUrl } from './calendar-subscribe.utils';

describe('calendar subscribe utils', () => {
  const feed = 'https://app.example.test/public/api/projects/p%201/calendar.ics';

  it('builds the project feed and public calendar paths', () => {
    expect(getProjectCalendarFeedUrl('https://app.example.test', 'p 1')).toBe(feed);
    expect(getPublicProjectCalendarPath('synthetic project')).toBe('/projects/synthetic%20project/calendar');
  });

  it('builds each calendar app link from the feed', () => {
    expect(toWebcalUrl('http://local.test/a.ics')).toBe('webcal://local.test/a.ics');
    expect(getCalendarSubscribeUrls(feed, 'Synthetic & Co')).toEqual({
      google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent('webcal://app.example.test/public/api/projects/p%201/calendar.ics')}`,
      outlookLive: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feed)}&name=Synthetic%20%26%20Co`,
      outlook365: `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(feed)}&name=Synthetic%20%26%20Co`,
      apple: 'webcal://app.example.test/public/api/projects/p%201/calendar.ics',
    });
  });
});
