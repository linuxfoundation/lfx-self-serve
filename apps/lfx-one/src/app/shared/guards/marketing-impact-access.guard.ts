// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { MARKETING_OPS_FGA_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { catchError, filter, map, Observable, of, switchMap, timeout } from 'rxjs';

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
 *
 * LaunchDarkly is browser-only (see `feature-flag.provider.ts`) — its provider never initializes
 * server-side, so reading the flag there always yields `false`, which would permanently deny a
 * non-ED FGA marketing auditor via a real SSR redirect before the client ever gets a chance to
 * check. On the server this treats the flag as off (the legacy ED/LF-Staff path below doesn't
 * depend on it) and defers the FGA branch to the client-side rerun of this guard, which awaits
 * `providerReady` before reading it.
 */
export const marketingImpactAccessGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  if (personaService.currentPersona() === 'executive-director') {
    return true;
  }

  const projectSlug = route.queryParamMap.get('project') ?? undefined;

  const providerReady$: Observable<boolean> = featureFlagService.providerReady()
    ? of(true)
    : toObservable(featureFlagService.providerReady).pipe(
        filter((isReady): isReady is true => isReady === true),
        timeout(5000),
        catchError(() => of(false))
      );

  const marketingOpsFgaEnabled$: Observable<boolean> = isPlatformBrowser(platformId)
    ? providerReady$.pipe(map((ready) => ready && featureFlagService.getBooleanFlag(MARKETING_OPS_FGA_ENABLED_FLAG, false)()))
    : of(false);

  return marketingOpsFgaEnabled$.pipe(
    switchMap((marketingOpsFgaEnabled) => {
      // Force a refetch unless we already know the caller is a marketing auditor — the "already
      // loaded" cache would otherwise stale-deny someone who gained the grant mid-session.
      const force = marketingOpsFgaEnabled && !personaService.isMarketingAuditor();

      return personaService.refreshEnrichedPersonas(force, marketingOpsFgaEnabled ? projectSlug : undefined).pipe(
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
    })
  );
};
