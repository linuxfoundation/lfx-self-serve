// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CalendarSubscribeApp } from '../interfaces/calendar.interface';

/** English month names, January first, for labels that must not vary with the viewer's locale. */
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** Calendar apps of the subscribe dialog, in order; brand hex colours of third-party marks, as PLATFORM_BRAND_COLORS does. */
export const CALENDAR_SUBSCRIBE_APPS: readonly CalendarSubscribeApp[] = [
  { key: 'google', label: 'Google Calendar', icon: 'fa-brands fa-google', color: '#4285F4' },
  { key: 'outlookLive', label: 'Outlook.com', icon: 'fa-brands fa-microsoft', color: '#0078D4' },
  { key: 'outlook365', label: 'Outlook 365', icon: 'fa-brands fa-microsoft', color: '#EA3E23' },
  { key: 'apple', label: 'Apple Calendar', icon: 'fa-brands fa-apple', color: '#000000' },
];
