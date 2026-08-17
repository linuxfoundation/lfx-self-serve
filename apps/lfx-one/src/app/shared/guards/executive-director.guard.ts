// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { MARKETING_OPS_FGA_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { map } from 'rxjs';

import { FeatureFlagService } from '../services/feature-flag.service';
import { PersonaService } from '../services/persona.service';

/**
 * Route guard restricting access to the Campaigns page — the only current consumer.
 *
 * The ED fast path stays fully synchronous (PersonaService is cookie-seeded, so SSR
 * never has to wait on API hydration for this check). While `marketing-ops-fga-enabled`
 * is off (the default), this is byte-identical to the original ED-only guard: no async
 * path is taken, non-ED users redirect immediately. When the flag is on, a non-ED caller
 * additionally gets a chance via a root/project-scoped `campaign_manager` FGA grant,
 * resolved asynchronously through the personas API (LFXV2-2236).
 */
export const executiveDirectorGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const router = inject(Router);

  if (personaService.currentPersona() === 'executive-director') {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);
  if (!featureFlagService.getBooleanFlag(MARKETING_OPS_FGA_ENABLED_FLAG, false)()) {
    return router.parseUrl('/foundation/overview');
  }

  const projectSlug = route.queryParamMap.get('project') ?? undefined;

  // Force a refetch unless we already know the caller is a campaign manager — the "already
  // loaded" cache would otherwise stale-deny someone who gained the grant mid-session.
  return personaService.refreshEnrichedPersonas(!personaService.isCampaignManager(), projectSlug).pipe(
    map(() => {
      if (personaService.isCampaignManager()) {
        return true;
      }
      return router.createUrlTree(['/foundation/overview'], { queryParams: { project: route.queryParamMap.get('project') } });
    })
  );
};
