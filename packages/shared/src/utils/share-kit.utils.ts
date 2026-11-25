// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SHARE_KIT_PLATFORM_LIMITS, SHARE_KIT_UTM_SOURCE } from '../constants/share-kit.constants';
import { ShareKitLinkTracking, ShareKitPlatform } from '../interfaces/share-kit.interface';
import { twitterWeightedLength } from './campaign-twitter.utils';

/**
 * Adds the share kit's tracking parameters to a link so clicks and registrations can be attributed
 * on the destination site. Existing query parameters are kept; tracking parameters are overwritten.
 */
export function buildShareKitTrackedUrl(url: string, tracking: ShareKitLinkTracking): string {
  const parsed = new URL(url);
  parsed.searchParams.set('utm_source', SHARE_KIT_UTM_SOURCE);
  parsed.searchParams.set('utm_medium', tracking.medium);
  parsed.searchParams.set('utm_campaign', tracking.campaign);
  parsed.searchParams.set('utm_content', tracking.content);
  return parsed.toString();
}

/** Joins post text and its link the way the copy buttons copy them. */
export function composeShareKitPost(text: string, link: string): string {
  return `${text.trim()}\n\n${link}`;
}

/**
 * Length of a composed post as the platform counts it. X uses its weighted count (CJK and most emoji count
 * twice, every link 23), Bluesky's app shortens pasted links to about 40, and LinkedIn counts the link in full.
 */
export function countShareKitPostLength(text: string, link: string, platform: ShareKitPlatform): number {
  if (platform === 'x') {
    return twitterWeightedLength(composeShareKitPost(text, link));
  }
  const { linkLength } = SHARE_KIT_PLATFORM_LIMITS[platform];
  return [...text.trim()].length + 2 + (linkLength ?? [...link].length);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parseIsoDay(day: string): { year: number; month: number; date: number } {
  const [year, month, date] = day.split('-').map(Number);
  return { year, month: month - 1, date };
}

/**
 * Formats an event's dates for display without time-zone shifts:
 * "April 28, 2027", "April 28–29, 2027", "April 28–30, 2027", "April 30 – May 2, 2027", "December 31, 2027 – January 2, 2028".
 */
export function formatShareKitDateRange(startDate: string, endDate: string): string {
  const start = parseIsoDay(startDate);
  const end = parseIsoDay(endDate);
  const startMonth = MONTHS[start.month];
  const endMonth = MONTHS[end.month];

  if (start.year !== end.year) {
    return `${startMonth} ${start.date}, ${start.year} – ${endMonth} ${end.date}, ${end.year}`;
  }
  if (start.month !== end.month) {
    return `${startMonth} ${start.date} – ${endMonth} ${end.date}, ${end.year}`;
  }
  if (start.date === end.date) {
    return `${startMonth} ${start.date}, ${start.year}`;
  }
  return `${startMonth} ${start.date}–${end.date}, ${start.year}`;
}

/** Formats one YYYY-MM-DD day as "February 28" (or "February 28, 2027" with the year). */
export function formatShareKitDay(day: string, withYear = false): string {
  const { year, month, date } = parseIsoDay(day);
  return withYear ? `${MONTHS[month]} ${date}, ${year}` : `${MONTHS[month]} ${date}`;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#RRGGBB` colours, from 1 to 21. */
export function shareKitContrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}
