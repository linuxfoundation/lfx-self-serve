// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';

/**
 * Overrides console.error to automatically format HttpErrorResponse objects
 * This prevents verbose object expansion in CloudWatch logs and matches backend Pino log format
 */
export function initializeConsoleOverride(): void {
  const originalConsoleError = console.error;

  console.error = (...args: any[]) => {
    const formattedArgs = args.map((arg) => {
      // Format HttpErrorResponse objects to match backend logging structure
      if (arg instanceof HttpErrorResponse) {
        return formatHttpError(arg);
      }
      return arg;
    });

    originalConsoleError.apply(console, formattedArgs);
  };
}

/**
 * Formats HttpErrorResponse into structured error object matching backend Pino format
 * Uses 'err' field convention consistent with server-side logging
 */
function formatHttpError(error: HttpErrorResponse): Record<string, any> {
  // Extract backend error details if available
  let errorMessage = error.statusText;
  let errorCode: string | undefined;

  if (error.error) {
    if (typeof error.error === 'string') {
      errorMessage = error.error;
    } else if (error.error.error) {
      errorMessage = error.error.error;
      errorCode = error.error.code;
    } else if (error.error.message) {
      errorMessage = error.error.message;
    }
  }

  // Return structured error object matching backend format with client-side indicator
  return {
    source: 'client',
    err: {
      type: 'HttpErrorResponse',
      message: errorMessage,
      statusCode: error.status,
      statusText: error.statusText,
      url: error.url || undefined,
      code: errorCode,
    },
    status_code: error.status,
    url: error.url || undefined,
  };
}
