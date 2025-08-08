// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TIMEZONES, type TimezoneOption } from '../constants';

// Helper function to get timezone by value
export function getTimezoneByValue(value: string): TimezoneOption | undefined {
  return TIMEZONES.find((tz) => tz.value === value);
}

// Helper function to get user's current timezone
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

// Helper function to format timezone display with current time
export function formatTimezoneWithCurrentTime(timezone: string): string {
  try {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    return `(${timeString})`;
  } catch {
    return '';
  }
}
