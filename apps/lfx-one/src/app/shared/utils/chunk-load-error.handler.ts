// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ErrorHandler, inject, Injectable } from '@angular/core';

import { ChunkLoadRecoveryService } from '../services/chunk-load-recovery.service';

@Injectable()
export class ChunkLoadErrorHandler implements ErrorHandler {
  private readonly recovery = inject(ChunkLoadRecoveryService);

  public handleError(error: unknown): void {
    this.recovery.handleError(error);
    // Preserve error reporting for SSR and unrelated failures, and make recovery attempts visible.
    console.error(error);
  }
}
