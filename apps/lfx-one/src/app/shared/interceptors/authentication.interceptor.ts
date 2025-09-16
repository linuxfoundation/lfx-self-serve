// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { UserService } from '@shared/services/user.service';
import { SsrCookieService } from 'ngx-cookie-service-ssr';

/**
 * Interceptor to add cookies to the request headers if the user is authenticated
 * @param req - The request object
 * @param next - The next interceptor in the chain
 * @returns The modified request object
 */
export const authenticationInterceptor: HttpInterceptorFn = (req, next) => {
  const cookieService = inject(SsrCookieService);
  const userService = inject(UserService);

  if ((req.url.startsWith('/api/') || req.url.startsWith('/public/api/')) && userService.authenticated()) {
    const authenticatedReq = req.clone({
      withCredentials: true,
      headers: req.headers.append(
        'Cookie',
        Object.entries(cookieService.getAll())
          .map(([key, value]) => `${key}=${value}`)
          .join('; ')
      ),
    });

    return next(authenticatedReq);
  }

  return next(req);
};
