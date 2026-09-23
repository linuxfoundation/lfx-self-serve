// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { API_GATEWAY_AUTH } from '@lfx-one/shared/constants';
import { catchError, EMPTY, throwError } from 'rxjs';

export const apiGatewayAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const document = inject(DOCUMENT);
  const platformId = inject(PLATFORM_ID);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (
        isPlatformBrowser(platformId) &&
        req.url.startsWith('/api/') &&
        error instanceof HttpErrorResponse &&
        error.status === 403 &&
        (error.error as Record<string, unknown> | null)?.['code'] === API_GATEWAY_AUTH.REQUIRED_CODE &&
        !new URLSearchParams(document.location.search).has(API_GATEWAY_AUTH.ERROR_PARAM)
      ) {
        const returnTo = document.location.pathname + document.location.search + document.location.hash;
        document.location.href = `${API_GATEWAY_AUTH.START_PATH}?returnTo=${encodeURIComponent(returnTo)}`;
        return EMPTY;
      }
      return throwError(() => error);
    })
  );
};
