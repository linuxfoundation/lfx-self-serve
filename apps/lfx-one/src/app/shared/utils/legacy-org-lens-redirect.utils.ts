// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { Router, UrlMatchResult, UrlSegment, UrlTree } from '@angular/router';
import { ORG_LENS_LEGACY_URL_ROOTS } from '@lfx-one/shared/constants';
import { companyLensRedirectTarget, legacyDocsRedirectTarget } from '@lfx-one/shared/utils';

/**
 * Matches every pre-rename Company Lens address — `/org`, `/organization` and anything beneath them — consuming the whole path so the
 * redirect sees the tail (`not-found`, `{slug|SFID}/{page}/…`, a legacy `{page}/…`). Only the exact segments `org` and
 * `organization`: `orgs` is another address.
 */
export function legacyOrgLensMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  return segments[0] && ORG_LENS_LEGACY_URL_ROOTS.includes(segments[0].path) ? { consumed: segments } : null;
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
  // An address ending in `/` keeps a trailing empty segment, so count only the named ones.
  const named = segments.filter((segment) => segment.path !== '');
  const first = named[0]?.path.toLowerCase();
  const movedDashboardsPage = named.length === 2 && first === 'dashboards' && named[1].path.toLowerCase() === 'organization-involvement';

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
