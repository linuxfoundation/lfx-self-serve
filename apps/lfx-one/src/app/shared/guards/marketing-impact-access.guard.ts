// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { MARKETING_OPS_FGA_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { map } from 'rxjs';

import { FeatureFlagService } from '../services/feature-flag.service';
import { PersonaService } from '../services/persona.service';

/**
 * Route guard for `/foundation/marketing-impact` only — deliberately a dedicated file rather
 * than an extension of `dashboardAccessGuard`, because that guard is shared with
 * `/foundation/health-metrics` and must stay ED/LF-staff-only (LFXV2-2236 gap-analysis G4/G13).
 *
 * While `marketing-ops-fga-enabled` is off (the default), this is byte-identical to
 * `dashboardAccessGuard`: ED fast path, else LF Staff via the personas API. When the flag is on,
 * a root/project-scoped `marketing_auditor` grant also admits — LF Staff still do not gain full
 * access, only the Social Listening tab the component itself restricts them to.
 */
export const marketingImpactAccessGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);

  if (personaService.currentPersona() === 'executive-director') {
    return true;
  }

  const marketingOpsFgaEnabled = featureFlagService.getBooleanFlag(MARKETING_OPS_FGA_ENABLED_FLAG, false)();

  return personaService.refreshEnrichedPersonas().pipe(
    map(() => {
      const allowed = marketingOpsFgaEnabled
        ? personaService.canViewExecutiveDashboards() || personaService.isMarketingAuditor()
        : personaService.canViewExecutiveDashboards();
      if (allowed) {
        return true;
      }
      return router.createUrlTree(['/foundation/overview'], { queryParams: { project: route.queryParamMap.get('project') } });
    })
  );
};
