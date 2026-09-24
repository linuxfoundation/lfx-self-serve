// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, signal } from '@angular/core';
import { defer, finalize, Observable } from 'rxjs';

/**
 * Auto ECLA writes still running, and the value each one asked for or confirmed, per organization
 * and agreement (#1988).
 *
 * Held above the page because the write outlives it: leaving the agreement does not cancel the
 * PUT, so state on the component would be forgotten on the way back. Losing the running write
 * would let a second one start for the same agreement, and turning Auto ECLA on also runs the
 * producer's approval-list backfill, so a duplicate is not free. Losing the remembered value
 * would show the list's stale flag once the write settles, until the list is next fetched.
 */
@Injectable({ providedIn: 'root' })
export class OrgClaAutoEclaWritesService {
  private readonly inFlight = signal<ReadonlySet<string>>(new Set());
  private readonly values = signal<Readonly<Record<string, boolean>>>({});

  public running(orgUid: string, signatureId: string): boolean {
    return this.inFlight().has(this.key(orgUid, signatureId));
  }

  /** The value last asked for or confirmed, or undefined when the list row is the truth. */
  public remembered(orgUid: string, signatureId: string): boolean | undefined {
    return this.values()[this.key(orgUid, signatureId)];
  }

  public remember(orgUid: string, signatureId: string, value: boolean): void {
    const key = this.key(orgUid, signatureId);
    this.values.update((current) => ({ ...current, [key]: value }));
  }

  /** Drops the remembered value once the list row carries it, unless it changed in the meantime. */
  public forget(orgUid: string, signatureId: string, value: boolean): void {
    const key = this.key(orgUid, signatureId);
    this.values.update((current) => {
      if (current[key] !== value) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
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
