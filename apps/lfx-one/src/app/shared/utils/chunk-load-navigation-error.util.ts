// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { NavigationError } from '@angular/router';

import { ChunkLoadRecoveryService } from '../services/chunk-load-recovery.service';

/** Runs in the router's injection context even when a caller handles navigate()'s rejection. */
export function handleChunkLoadNavigationError(event: NavigationError): void {
  // Only a RedirectCommand changes Angular's error path. Returning void preserves
  // NavigationError, promise rejection, and RouterLink's application error reporting.
  if (inject(ChunkLoadRecoveryService).handleError(event.error)) console.error(event.error);
}
