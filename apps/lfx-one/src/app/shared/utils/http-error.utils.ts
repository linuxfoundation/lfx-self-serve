// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';

/**
 * Extracts a user-friendly error message from an HttpErrorResponse.
 * Prefers the upstream service message when available; falls back to
 * status-code hints, then the provided fallback string.
 */
export function getHttpErrorDetail(err: HttpErrorResponse, fallback: string): string {
  const upstream = err.error?.message as string | undefined;

  switch (err.status) {
    case 409:
      return upstream ?? 'This resource already exists.';
    case 404:
      return upstream ?? 'The resource was not found.';
    case 403:
      return upstream ?? 'You do not have permission to perform this action.';
    case 422:
      return upstream ?? 'The request contained invalid data. Please check your input.';
    case 400:
      return upstream ?? fallback;
    default:
      return upstream ?? fallback;
  }
}
