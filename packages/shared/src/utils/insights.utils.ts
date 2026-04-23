// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKS_CONFIG } from '../constants/links.config';

/**
 * Builds an LFX Insights URL from an optional path and query params.
 *
 * - Each path segment is `encodeURIComponent`-ed so slugs with reserved
 *   characters (`/`, `%`, spaces, etc.) produce a valid URL.
 * - Param values with `undefined` or empty string are filtered out; remaining
 *   keys and values are URL-encoded.
 * - Empty `path` returns the Insights base URL unchanged.
 */
export function buildInsightsUrl(path: string = '', params?: Record<string, string | undefined>): string {
  const base = LINKS_CONFIG.INSIGHTS.BASE;
  const normalizedPath = encodePathSegments(path);
  let url = `${base}${normalizedPath}`;
  if (params) {
    const query = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`)
      .join('&');
    if (query) {
      url += `?${query}`;
    }
  }
  return url;
}

/**
 * Builds a lens-aware Insights handoff URL for a dashboard drawer.
 *
 * - Foundation context → `/collection/details/{slug}`.
 * - Project context → `/project/{slug}[/projectSubPath][?projectParams]`.
 * - Missing slug → Insights root, so the link never renders broken.
 *
 * Centralizes the foundation-vs-project branching used by every dashboard
 * drawer's "Open in LFX Insights" handoff, so the URL map lives in one place.
 */
export function buildLensAwareInsightsUrl(
  slug: string | null | undefined,
  isFoundationContext: boolean,
  opts: { projectSubPath?: string; projectParams?: Record<string, string | undefined> } = {}
): string {
  if (!slug) {
    return buildInsightsUrl();
  }
  if (isFoundationContext) {
    return buildInsightsUrl(`/collection/details/${slug}`);
  }
  const path = opts.projectSubPath ? `/project/${slug}/${opts.projectSubPath}` : `/project/${slug}`;
  return buildInsightsUrl(path, opts.projectParams);
}

function encodePathSegments(path: string): string {
  if (!path) {
    return '';
  }
  const prefixed = path.startsWith('/') ? path : `/${path}`;
  return prefixed
    .split('/')
    .map((segment) => (segment === '' ? segment : encodeURIComponent(segment)))
    .join('/');
}
