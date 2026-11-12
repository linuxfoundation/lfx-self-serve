// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OPENPROFILE_APPLYFOR_TABS, OPENPROFILE_REDIRECT_MARKER, OPENPROFILE_REDIRECTS, PROFILE_ROUTE_SEGMENTS } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

// Raw (still percent-encoded) path segments; anything with `%` or other characters is not carried over.
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const TRAVEL_FUNDING_ID = /^\/myevents\/travel-funding\/([^/]+)$/i;
const EVENT_SLUG = /^\/myevents\/[^/]+$/i;
const NEWSLETTER_ID = /^\/newsletter\/[^/]+$/i;
const PROFILE_USERNAME = /^\/profile\/([^/]+)$/i;

function firstString(value: Request['query'][string]): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : undefined;
}

function safeSegment(value: string | undefined): string | undefined {
  return value && SAFE_SEGMENT.test(value) ? value : undefined;
}

function withQuery(target: string, query: Request['query'], extra: Record<string, string | undefined>): string {
  const url = new URL(target, 'http://openprofile.invalid');
  for (const [key, value] of Object.entries(extra)) {
    if (value) url.searchParams.set(key, value);
  }
  for (const [key, value] of Object.entries(query)) {
    const str = firstString(value);
    if (key.toLowerCase().startsWith('utm_') && str !== undefined) url.searchParams.set(key, str);
  }
  url.searchParams.set(OPENPROFILE_REDIRECT_MARKER.key, OPENPROFILE_REDIRECT_MARKER.value);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Maps an old Individual Dashboard (openprofile.dev) path to its Self Serve URL, or `null` when the path
 * isn't an old one. Self Serve paths that overlap with old ones (`/`, `/profile`, `/settings`) are left alone.
 */
export function resolveOpenprofileRedirect(path: string, query: Request['query']): string | null {
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const lower = normalized.toLowerCase();

  if (lower === '/myevents') {
    const tab = OPENPROFILE_APPLYFOR_TABS[firstString(query['applyfor']) ?? ''];
    return withQuery('/events', query, { tab, event: tab ? safeSegment(firstString(query['event'])) : undefined });
  }

  const exact = OPENPROFILE_REDIRECTS[lower];
  if (exact) return withQuery(exact, query, {});

  const travelFunding = TRAVEL_FUNDING_ID.exec(normalized);
  if (travelFunding) return withQuery('/events', query, { tab: 'travel-funding', event: safeSegment(travelFunding[1]) });

  if (EVENT_SLUG.test(normalized)) return withQuery('/events', query, {});
  if (NEWSLETTER_ID.test(normalized)) return withQuery('/newsletters/my', query, {});

  const username = safeSegment(PROFILE_USERNAME.exec(normalized)?.[1]);
  if (username && !PROFILE_ROUTE_SEGMENTS.has(username.toLowerCase())) return withQuery(`/u/${username}`, query, {});

  return null;
}

/**
 * Redirects old openprofile.dev paths (IT forwards `openprofile.dev/*` to this host unchanged) to their Self Serve
 * pages. Registered before auth so signed-out visitors are redirected first. 302 + no-store keeps the map reversible.
 */
export function openprofileRedirect(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }
  const target = resolveOpenprofileRedirect(req.path, req.query);
  if (!target) {
    next();
    return;
  }
  res.set('Cache-Control', 'no-store');
  res.redirect(302, target);
}
