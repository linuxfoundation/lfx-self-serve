// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, UrlTree } from '@angular/router';
import { catchError, map, Observable, of } from 'rxjs';

import { VoteService } from '../services/vote.service';
import { retryTransientHttpError } from '../utils/http-error.utils';

/**
 * Gates the chrome-less presenter route (`votes/:id/present`) on `vote#writer` for this vote.
 *
 * The flag is decorated onto `GET /api/votes/:uid` by the BFF, so the guard, the Present entry points and the
 * server share one source of truth (writerGuard checks project/committee writer instead and is not reused here).
 * The writer-inclusive read is never cached, so a just-granted or just-revoked writer is never judged on stale data.
 *
 * Denial redirects to `/votes` with `_notice=access`; AppComponent turns that into the standard "Access Denied"
 * toast and strips it, which also works on a full-page SSR load. A transient lookup failure (retried once) redirects
 * with `_notice=error` instead, so a server blip is never misreported as a permission denial.
 */
export const votePresenterGuard: CanActivateFn = (route: ActivatedRouteSnapshot): Observable<boolean | UrlTree> => {
  const voteService = inject(VoteService);
  const router = inject(Router);
  const deny = (notice: 'access' | 'error'): UrlTree => router.createUrlTree(['/votes'], { queryParams: { _notice: notice } });

  const voteUid = route.paramMap.get('id');
  if (!voteUid) {
    return of(deny('access'));
  }

  return voteService.fetchVote(voteUid, { includeWriter: true }).pipe(
    retryTransientHttpError(),
    map((vote) => (vote.writer === true ? true : deny('access'))),
    catchError((err) => of(err?.status === 403 || err?.status === 404 ? deny('access') : deny('error')))
  );
};
