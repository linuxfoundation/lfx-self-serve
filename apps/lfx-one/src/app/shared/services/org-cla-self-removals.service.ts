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

  /** Called when an organization's CLA list is loaded afresh. */
  public forgetAll(): void {
    this.removals.update((current) => (current.size === 0 ? current : new Set()));
  }

  /**
   * Keeps only this organization's removals whose agreement a re-read still lists the viewer on.
   * EasyCLA can go on listing a manager for a while after the removal, and that answer must not
   * bring the controls back.
   */
  public keepOnly(orgUid: string, stillListed: ReadonlySet<string>): void {
    const prefix = this.key(orgUid, '');
    this.removals.update((current) => {
      const kept = new Set([...current].filter((key) => !key.startsWith(prefix) || stillListed.has(key.slice(prefix.length))));
      return kept.size === current.size ? current : kept;
    });
  }

  private key(orgUid: string, signatureId: string): string {
    return `${orgUid}::${signatureId}`;
  }
}
