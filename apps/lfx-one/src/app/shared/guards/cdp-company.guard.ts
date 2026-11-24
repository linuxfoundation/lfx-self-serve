// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, CanMatchFn } from '@angular/router';
import { CDP_COMPANY_ID_RESERVED_PATTERN } from '@lfx-one/shared/constants';
import { map } from 'rxjs';

import { CdpCompanyService } from '../services/cdp-company.service';

/**
 * `/company/:cdpId` matches only a segment shaped like a CDP id (a crowd.dev organization UUID, spec 062 FR-024,
 * DR-012), in any letter case: `isOrgSlugSegment` rejects that shape, so no other Company Lens route can claim it and
 * a CDP-shaped address never reaches the B2B `/company/:orgSegment` tree or its resolver. Only the lowercase form is a
 * CDP id; the shell reads any other case as a malformed address, the same "no company" an unknown id gets.
 */
export const cdpCompanyMatchGuard: CanMatchFn = (_route, segments) => {
  const segment = segments[0]?.path;
  return !!segment && CDP_COMPANY_ID_RESERVED_PATTERN.test(segment);
};

/**
 * Holds the CDP company shell until the browser knows whether CDP pages are available to the caller
 * (`/api/companies/availability`, FR-014), so the shell never renders, or asks for a company, before the audience
 * answer is in.
 *
 * It never redirects. An outsider, an unknown id and a malformed id render the same in-shell "no company" state at
 * the address the viewer opened, and a failed check renders "could not verify" (FR-012, FR-013, FR-035): a redirect
 * would tell those cases apart by where it lands. The shell decides the id format and the audience answer itself.
 *
 * The server passes straight through: SSR has no audience answer (`availability()` answers `unavailable` there), so the
 * shell renders its skeleton and the browser run decides after hydration.
 */
export const cdpCompanyGuard: CanActivateFn = () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;
  return inject(CdpCompanyService)
    .availability()
    .pipe(map(() => true));
};
