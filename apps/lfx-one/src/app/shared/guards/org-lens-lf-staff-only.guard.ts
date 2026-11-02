// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanMatchFn, Router, UrlTree } from '@angular/router';
import { orgLensPagePath } from '@lfx-one/shared/utils';
import { map } from 'rxjs';

import { PersonaService } from '../services/persona.service';
import { UserService } from '../services/user.service';

/**
 * `/org/{segment}/roi` (and the legacy `/org/roi`) is open only to LF staff, in every environment. The server applies the
 * same rule to the data (`requireOrgLensRoiAudience`); this guard decides only what renders, on the server as well, so a
 * non-staff request is redirected before the page is built.
 */
export const orgLensLfStaffOnlyGuard: CanMatchFn = () => {
  const personaService = inject(PersonaService);
  const userService = inject(UserService);
  const router = inject(Router);
  // The fallback stays in the organization the address names (spec 050): this CanMatch runs during recognition, before
  // `orgPathParamGuard` has adopted the segment, and an absolute `/org/overview` would land on the cookie organization.
  const target = router.getCurrentNavigation()?.extractedUrl;
  const segments = target?.root.children['primary']?.segments.map((segment) => segment.path) ?? [];
  const overview: UrlTree = router.parseUrl(orgLensPagePath(segments, 'overview'));

  // `refreshEnrichedPersonas` answers from cache after the first load and resolves `null` when the lookup fails, so an
  // unanswered lookup leaves `isLFStaff` false and the page closed.
  return personaService.refreshEnrichedPersonas().pipe(map(() => (personaService.isLFStaff() && !userService.impersonating() ? true : overview)));
};
