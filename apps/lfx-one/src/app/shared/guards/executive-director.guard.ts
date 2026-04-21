// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { PersonaService } from '../services/persona.service';

/**
 * Route guard that restricts access to executive-director-only pages.
 *
 * Works on both server and client: PersonaService is cookie-seeded so
 * currentPersona() returns a synchronous value during SSR without
 * waiting for API hydration. Non-ED users are redirected to the
 * foundation overview on every platform.
 */
export const executiveDirectorGuard: CanActivateFn = () => {
  const personaService = inject(PersonaService);
  const router = inject(Router);
  const persona = personaService.currentPersona();

  if (persona === 'executive-director') {
    return true;
  }

  return router.parseUrl('/foundation/overview');
};
