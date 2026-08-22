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
 * server-side, so reading the flag there always yields `false`. If the FGA branch ran on the
 * server it would emit `false`, fall through to the legacy path, and issue a real SSR redirect
 * for a non-ED `marketing_auditor` before the client ever gets a chance to re-evaluate the guard
 * — permanently locking them out. On the server this returns `true` directly (matching
 * `executiveDirectorGuard`) and defers the full flag + FGA evaluation to the client-side rerun,
 * which awaits `providerReady` before reading it (LFXV2-2236).
 */
export const marketingImpactAccessGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  if (personaService.currentPersona() === 'executive-director') {
    return true;
  }

  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);
  const projectSlug = route.queryParamMap.get('project') ?? undefined;

  // Check for a local flag override first, before waiting for provider readiness.
  // This ensures E2E tests with pinned overrides don't timeout waiting for LaunchDarkly.
  const override = featureFlagService.getFlagOverride(MARKETING_OPS_FGA_ENABLED_FLAG);
  if (override !== undefined) {
    // Force a refetch unless we already know the caller is a marketing auditor.
    const force = override && !personaService.isMarketingAuditor();
    return personaService.refreshEnrichedPersonas(force, override ? projectSlug : undefined).pipe(
      map(() => {
        const allowed = override
          ? personaService.canViewExecutiveDashboards() || personaService.isMarketingAuditor()
          : personaService.canViewExecutiveDashboards();
        if (allowed) {
          return true;
        }
        return router.createUrlTree(['/foundation/overview'], { queryParams: { project: route.queryParamMap.get('project') } });
      })
    );
  }

  const providerReady$: Observable<boolean> = featureFlagService.providerReady()
    ? of(true)
    : toObservable(featureFlagService.providerReady).pipe(
        filter((isReady): isReady is true => isReady === true),
        timeout(5000),
        catchError(() => of(false))
      );

  return providerReady$.pipe(
    map((ready) => ready && featureFlagService.getBooleanFlag(MARKETING_OPS_FGA_ENABLED_FLAG, false)()),
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
