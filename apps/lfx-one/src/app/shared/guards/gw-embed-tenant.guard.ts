// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { isGwEmbedAllowedForSlug } from '@lfx-one/shared/utils';

import { ProjectContextService } from '../services/project-context.service';

/**
 * Restricts the embedded Gatewaze admin pilot to the tenant Gatewaze can actually serve.
 *
 * Gatewaze has no multi-foundation scoping: one deployment serves one tenant's content. Opening the
 * embed from any other foundation would render THAT foundation's chrome around AAIF's newsletters —
 * the wrong data under the wrong brand, not an empty state. So this is a data-isolation control,
 * and it belongs on the route as well as the sidebar, because a URL is guessable and shareable.
 *
 * `CanActivate`, NOT `CanMatch`, and ordered AFTER `projectQueryParamGuard`. The first version read
 * `?project=` off `window.location` inside the CanMatch guard, which fails: the project-context
 * layer reconciles that parameter during bootstrap, so by the time a CanMatch guard runs the URL
 * can already carry a cookie-restored selection rather than the one the user asked for. Observed
 * directly — a navigation to `?project=agentic-ai-foundation` reached the guard as
 * `?project=depth_test_1` and was refused.
 *
 * Reading the resolved context instead means this guard and `sidebar-nav.service.ts` agree on what
 * "the current tenant" is, rather than consulting two sources that disagree mid-bootstrap.
 *
 * Either slot may carry it: AAIF is a foundation, so it is the foundation selection on the
 * `/foundation/gw` mount, and the project selection on `/project/gw`.
 */
export const gwEmbedTenantGuard: CanActivateFn = () => {
  const projectContextService = inject(ProjectContextService);
  const router = inject(Router);

  const foundationSlug = projectContextService.selectedFoundation()?.slug;
  const projectSlug = projectContextService.selectedProject()?.slug;

  if (isGwEmbedAllowedForSlug(foundationSlug) || isGwEmbedAllowedForSlug(projectSlug)) {
    return true;
  }

  // Fails closed, including when neither slot has resolved: not knowing the tenant is exactly the
  // case that would render the wrong one.
  return router.parseUrl('/');
};
