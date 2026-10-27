// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable } from '@angular/core';

/**
 * Hands out DOM ids that are unique within one rendered app, for `id` / `aria-describedby` pairs on
 * components mounted more than once (e.g. the desktop and mobile-drawer navbars).
 * @description The counters live on a root service rather than in a module-level or static field: SSR
 * bootstraps a fresh root injector per request, so each server render starts from the same count the
 * browser does, instead of continuing a process-wide sequence across requests.
 */
@Injectable({
  providedIn: 'root',
})
export class ElementIdService {
  private readonly counters = new Map<string, number>();

  /** The next id for `prefix`: `prefix-0`, `prefix-1`, … */
  public next(prefix: string): string {
    const count = this.counters.get(prefix) ?? 0;
    this.counters.set(prefix, count + 1);
    return `${prefix}-${count}`;
  }
}
