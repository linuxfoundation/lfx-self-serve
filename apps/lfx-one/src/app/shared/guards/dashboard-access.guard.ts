// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';

import { PersonaService } from '../services/persona.service';

/**
 * Route guard for executive-tier dashboard pages open to both Executive Directors
 * and LF Staff (`team:lf-staff#member`) — e.g. Foundation Health, Marketing Impact.
 *
 * Unlike `currentPersona`, LF-staff membership isn't cookie-seeded (it's a request-scoped
 * OpenFGA check, not part of the persisted persona state), so the ED fast path stays
 * synchronous for SSR while the LF-staff fallback awaits the personas API.
 */
export const dashboardAccessGuard: CanActivateFn = () => {
  const personaService = inject(PersonaService);
  const router = inject(Router);

  if (personaService.currentPersona() === 'executive-director') {
    return true;
  }

  return personaService.refreshEnrichedPersonas().pipe(
    map(() => {
      if (personaService.canViewExecutiveDashboards()) {
        return true;
      }
      return router.parseUrl('/foundation/overview');
    })
  );
};
