// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { RedirectFunction, Router } from '@angular/router';
import { LENS_DEFAULT_ROUTES } from '@lfx-one/shared/constants';

import { LensService } from '../services/lens.service';

/**
 * Flat `/documents` used to be the Me-lens My Documents page (#2990). That page is removed.
 *
 * - Foundation / project lens: land on `/foundation/documents` or `/project/documents`,
 *   keeping the query string so an old project-scoped link still opens the right context.
 * - Me / org lens: land on that lens's home. `/` carries `data.lens: 'me'`, so sending an org
 *   user there would switch them to the Me lens.
 */
export const flatDocumentsRedirect: RedirectFunction = ({ queryParams, fragment }) => {
  const lens = inject(LensService).activeLens();
  const router = inject(Router);

  if (lens === 'foundation' || lens === 'project') {
    return router.createUrlTree(['/', lens, 'documents'], {
      queryParams,
      fragment: fragment ?? undefined,
    });
  }

  return router.createUrlTree([LENS_DEFAULT_ROUTES[lens]]);
};
