// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKS_CONFIG } from '../constants/links.config';
import type { HealthScore } from '../interfaces';

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

/**
 * Classifies an LFX Insights project health score (0–100) into a band, matching the Insights
 * primary project Health Score component (`health-score.vue`): `>= 80` Excellent, `>= 60` Healthy,
 * `>= 40` Stable, `>= 20` Unsteady, else Critical. The `unavailable` state (no score) is handled by
 * callers, so this returns only the five scored bands and is the single source both the Org Lens
 * Projects table and the project-detail hero classify through (they must never disagree).
 */
export function classifyHealthScore(score: number): Exclude<HealthScore, 'unavailable'> {
  if (score >= 80) {
    return 'excellent';
  }
  if (score >= 60) {
    return 'healthy';
  }
  if (score >= 40) {
    return 'stable';
  }
  if (score >= 20) {
    return 'unsteady';
  }
  return 'critical';
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
