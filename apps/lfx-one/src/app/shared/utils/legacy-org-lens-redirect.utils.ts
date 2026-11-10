// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { Router, UrlMatchResult, UrlSegment, UrlTree } from '@angular/router';
import { ORG_LENS_LEGACY_URL_ROOT } from '@lfx-one/shared/constants';
import { companyLensRedirectTarget, legacyDocsRedirectTarget } from '@lfx-one/shared/utils';

/**
 * Matches every pre-rename Company Lens address — `/org` and anything beneath it — consuming the whole path so the
 * redirect sees the tail (`not-found`, `{slug|SFID}/{page}/…`, a legacy `{page}/…`). Only the exact segment `org`:
 * `organization` or `orgs` are other addresses.
 */
export function legacyOrgLensMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  return segments[0]?.path === ORG_LENS_LEGACY_URL_ROOT ? { consumed: segments } : null;
}

/**
 * Router-side twin of the server's permanent `/org/…` redirect (#5064): the same page and selection under
 * `/company/…`, query string and fragment kept, so an in-app navigation or a client-side deep link to an old
 * address lands where a full page load would. Runs in an injection context (`redirectTo` function).
 */
export function legacyOrgLensRedirect(data: LegacyRedirectData): UrlTree {
  return redirectTo(data, '', companyLensRedirectTarget);
}

/** Router-side twin of the server's `/docs/organization/…` → `/docs/company/…` redirect; mounted under the `docs` route. */
export function legacyDocsRedirect(data: LegacyRedirectData): UrlTree {
  return redirectTo(data, '/docs', legacyDocsRedirectTarget);
}

/** Matches the moved docs section (`organization` and anything beneath it) and the renamed dashboards page under the `docs` route. */
export function legacyDocsMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  const first = segments[0]?.path.toLowerCase();
  const movedDashboardsPage = segments.length === 2 && first === 'dashboards' && segments[1].path.toLowerCase() === 'organization-involvement';

  return first === 'organization' || movedDashboardsPage ? { consumed: segments } : null;
}

interface LegacyRedirectData {
  url: UrlSegment[];
  queryParams: Record<string, string | string[]>;
  fragment: string | null;
}

function redirectTo(data: LegacyRedirectData, prefix: string, rewrite: (pathAndQuery: string) => string | null): UrlTree {
  const router = inject(Router);
  const serialized = router.serializeUrl(
    router.createUrlTree([prefix || '/', ...data.url.map((segment) => segment.path)], { queryParams: data.queryParams, fragment: data.fragment ?? undefined })
  );
  const hashStart = serialized.indexOf('#');
  const fragment = hashStart === -1 ? '' : serialized.slice(hashStart);
  const target = rewrite(hashStart === -1 ? serialized : serialized.slice(0, hashStart));
  return router.parseUrl(`${target ?? serialized}${fragment}`);
}
