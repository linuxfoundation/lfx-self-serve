// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';

import { PersonaService } from '../services/persona.service';

/**
 * Retains the pre-marketing-ops foundation product gate (board role or root writer) on
 * non-marketing foundation routes.
 *
 * Marketing Ops / Marketing Auditors gain the foundation lens via `isRootMarketingAuditor`
 * so they can reach Marketing surfaces (FR/SC-008), but MUST NOT inherit Meetings, Events,
 * Groups, Documents, Governance, etc. (FR-017). Those routes keep this guard; marketing
 * routes use `marketingViewGuard` / `campaignAccessGuard` instead. Overview stays open so
 * Marketing Ops can land on the dashboard Marketing Overview section.
 */
export const foundationProductGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const router = inject(Router);

  if (personaService.hasBoardRole() || personaService.isRootWriter()) {
    return true;
  }

  const slug = route.queryParamMap.get('project');
  return slug ? router.createUrlTree(['/foundation/overview'], { queryParams: { project: slug } }) : router.parseUrl('/foundation/overview');
};
