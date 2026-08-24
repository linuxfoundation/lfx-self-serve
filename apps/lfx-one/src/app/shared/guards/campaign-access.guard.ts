// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { MARKETING_OPS_FGA_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { catchError, filter, map, of, switchMap, timeout } from 'rxjs';

import { FeatureFlagService } from '../services/feature-flag.service';
import { PersonaService } from '../services/persona.service';

/**
 * Route guard restricting access to the Campaigns page — the only current consumer.
 *
 * The ED fast path stays fully synchronous (PersonaService is cookie-seeded, so SSR
 * never has to wait on API hydration for this check). LaunchDarkly is browser-only
 * (see `feature-flag.provider.ts`) — its provider never initializes server-side, so
 * reading the flag there always yields its default (`false`), which would permanently
 * redirect a non-ED FGA campaign manager away via a real SSR redirect before the client
 * ever gets a chance to check. On the server this defers instead, matching
 * `mktgOsAgentsEnabledGuard`/`akritesEnabledGuard`: the client-side rerun of this guard
 * after hydration awaits `providerReady` and makes the real decision (LFXV2-2236).
 */
export const campaignAccessGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const router = inject(Router);

  if (personaService.currentPersona() === 'executive-director') {
    return true;
  }

  const platformId = inject(PLATFORM_ID);
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);
  const projectSlug = route.queryParamMap.get('project') ?? undefined;

  // Check for a local flag override first, before waiting for provider readiness.
  // This ensures E2E tests with pinned overrides don't timeout waiting for LaunchDarkly.
  const override = featureFlagService.getFlagOverride(MARKETING_OPS_FGA_ENABLED_FLAG);
  if (override !== undefined) {
    if (!override) {
      return router.parseUrl('/foundation/overview');
    }
    // Override says flag is on; continue to FGA check below.
    return personaService.refreshEnrichedPersonas(!personaService.isCampaignManager(), projectSlug).pipe(
      map(() => {
        if (personaService.currentPersona() === 'executive-director' || personaService.isCampaignManager()) {
          return true;
        }
        return router.createUrlTree(['/foundation/overview'], { queryParams: { project: route.queryParamMap.get('project') } });
      })
    );
  }

  const providerReady$ = featureFlagService.providerReady()
    ? of(true)
    : toObservable(featureFlagService.providerReady).pipe(
        filter((isReady): isReady is true => isReady === true),
        timeout(5000),
        catchError(() => of(false))
      );

  return providerReady$.pipe(
    switchMap((ready) => {
      if (!ready || !featureFlagService.getBooleanFlag(MARKETING_OPS_FGA_ENABLED_FLAG, false)()) {
        return of(router.parseUrl('/foundation/overview'));
      }

      // Force a refetch unless we already know the caller is a campaign manager — the "already
      // loaded" cache would otherwise stale-deny someone who gained the grant mid-session.
      return personaService.refreshEnrichedPersonas(!personaService.isCampaignManager(), projectSlug).pipe(
        map(() => {
          // Re-check ED too — applyPersonaResponse can promote currentPersona as a side effect of
          // this refetch, and an ED without an explicit campaign_manager grant must still pass.
          if (personaService.currentPersona() === 'executive-director' || personaService.isCampaignManager()) {
            return true;
          }
          return router.createUrlTree(['/foundation/overview'], { queryParams: { project: route.queryParamMap.get('project') } });
        })
      );
    })
  );
};
