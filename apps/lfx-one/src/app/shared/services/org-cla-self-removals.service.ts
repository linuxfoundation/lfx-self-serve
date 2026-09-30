// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, signal } from '@angular/core';

/**
 * Agreements the viewer has removed themselves from as CLA manager, per organization, since the
 * CLA list was last requested.
 *
 * Held above the page because the removal outlives the Managers panel: leaving the tab or the
 * agreement does not cancel the DELETE, so a record kept on the panel would be lost with it and
 * the page would go on offering the roster-gated writes the producer now refuses.
 */
@Injectable({ providedIn: 'root' })
export class OrgClaSelfRemovalsService {
  private readonly removals = signal<ReadonlySet<string>>(new Set());

  public removed(orgUid: string, signatureId: string): boolean {
    return this.removals().has(this.key(orgUid, signatureId));
  }

  public record(orgUid: string, signatureId: string): void {
    const key = this.key(orgUid, signatureId);
    this.removals.update((current) => new Set(current).add(key));
  }

  /** Called when a CLA list is requested: a list asked for after the removal is the truth. */
  public forgetAll(): void {
    this.removals.update((current) => (current.size === 0 ? current : new Set()));
  }

  private key(orgUid: string, signatureId: string): string {
    return `${orgUid}::${signatureId}`;
  }
}
