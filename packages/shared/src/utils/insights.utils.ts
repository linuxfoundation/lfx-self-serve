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
 * Classifies an LFX Insights project health score (0–100) into a band, matching lf-dbt's
 * `get_health_score_category_v2` macro and the Insights primary project Health Score component
 * (`health-score.vue`): `>= 85` Excellent, `>= 70` Healthy, `>= 50` Fair, `>= 30` Concerning, else
 * Critical. The `unavailable` state (no score) is handled by callers, so this returns only the five
 * scored bands and is the single source both the Org Lens Projects table and the project-detail hero
 * classify through (they must never disagree).
 */
export function classifyHealthScore(score: number): Exclude<HealthScore, 'unavailable'> {
  if (score >= 85) {
    return 'excellent';
  }
  if (score >= 70) {
    return 'healthy';
  }
  if (score >= 50) {
    return 'fair';
  }
  if (score >= 30) {
    return 'concerning';
  }
  return 'critical';
}

/**
 * A health score is partial when the warehouse's `covered_category_count_v2` reports exactly 2 of the
 * 3 CHAOSS categories covered (`health_max_score_v2` is 60/65/75 rather than 100). `< 2` categories
 * means no score at all (`health`/`healthMaxScore` are `null`/`unavailable`), and `3` is a full score —
 * neither is partial.
 */
export function isPartialHealthScore(coveredCategoryCount: number | null): boolean {
  return coveredCategoryCount === 2;
}

const HEALTH_SCORE_CATEGORIES = new Set<Exclude<HealthScore, 'unavailable'>>(['excellent', 'healthy', 'fair', 'concerning', 'critical']);

/**
 * Normalizes the warehouse-computed `health_score_category_v2` column (lf-dbt's `get_health_score_category_v2`
 * macro, e.g. "Excellent"/"Fair"/"Concerning") into the lowercase `HealthScore` band. Returns `null` for
 * unset/unrecognized values so callers can fall back to `classifyHealthScore` on the v1 score for projects
 * the warehouse hasn't backfilled with a v2 category yet.
 */
export function normalizeHealthScoreCategoryV2(category: string | null | undefined): Exclude<HealthScore, 'unavailable'> | null {
  if (!category) {
    return null;
  }
  const lower = category.toLowerCase() as Exclude<HealthScore, 'unavailable'>;
  return HEALTH_SCORE_CATEGORIES.has(lower) ? lower : null;
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
