// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ErrorHandler, inject, Injectable, PLATFORM_ID } from '@angular/core';

const RELOAD_FLAG = 'lfx-chunk-reload-at';
const RELOAD_LOOP_WINDOW_MS = 60_000;

const isChunkLoadError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Importing a module script failed') || // Safari
    message.includes('Failed to fetch dynamically imported module') || // Chrome / Edge
    message.includes('error loading dynamically imported module') // Firefox
  );
};

@Injectable()
export class ChunkLoadErrorHandler implements ErrorHandler {
  private readonly platformId = inject(PLATFORM_ID);

  public handleError(error: unknown): void {
    // SSR + non-chunk errors fall through to default ErrorHandler behavior so logs surface.
    if (!isPlatformBrowser(this.platformId) || !isChunkLoadError(error)) {
      console.error(error);
      return;
    }

    // Timestamp-based loop guard: bail only if we already reloaded within the window.
    const lastReloadStr = sessionStorage.getItem(RELOAD_FLAG);
    const lastReload = lastReloadStr ? Number(lastReloadStr) : 0;
    if (lastReload && Date.now() - lastReload < RELOAD_LOOP_WINDOW_MS) {
      console.error('Chunk load error within 60s of reload — likely a loop, giving up.', error);
      return;
    }

    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    window.location.reload();
  }
}
