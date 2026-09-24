// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, signal } from '@angular/core';
import { defer, finalize, Observable } from 'rxjs';

/**
 * Auto ECLA writes still running, one per organization and agreement (#1988).
 *
 * Held above the page because the write outlives it: leaving the agreement does not cancel the
 * PUT, so a registry on the component would forget it on the way back and let a second write
 * start for the same agreement. Turning Auto ECLA on also runs the producer's approval-list
 * backfill, so a duplicate is not free.
 */
@Injectable({ providedIn: 'root' })
export class OrgClaAutoEclaWritesService {
  private readonly inFlight = signal<ReadonlySet<string>>(new Set());

  public running(orgUid: string, signatureId: string): boolean {
    return this.inFlight().has(this.key(orgUid, signatureId));
  }

  /** Marks the agreement as writing when `write` is subscribed and clears it when it settles. */
  public track<T>(orgUid: string, signatureId: string, write: Observable<T>): Observable<T> {
    const key = this.key(orgUid, signatureId);
    return defer(() => {
      this.inFlight.update((current) => new Set(current).add(key));
      return write.pipe(
        finalize(() =>
          this.inFlight.update((current) => {
            const next = new Set(current);
            next.delete(key);
            return next;
          })
        )
      );
    });
  }

  private key(orgUid: string, signatureId: string): string {
    return `${orgUid}::${signatureId}`;
  }
}
