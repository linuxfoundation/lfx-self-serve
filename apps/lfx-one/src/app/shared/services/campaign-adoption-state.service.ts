// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, Signal, signal } from '@angular/core';
import type { CampaignAdoptFailure, CampaignAdoptionInFlight } from '@lfx-one/shared/interfaces';

/**
 * Remembers adoptions whose outcome is not settled, beyond the adopt dialog that sent them
 * (lfx-self-serve#3299).
 *
 * The dialog is created fresh on every opening, so a lock held only in it was lost by Cancel: a
 * reopened dialog offered Adopt again over an adoption that may already be recorded (or still in
 * flight). Root-provided so the write's own callbacks, which outlive the dialog, can settle the entry,
 * and so any later dialog for the same campaign reads it.
 *
 * Keyed by project, platform and platform campaign id: the same id under another project or platform
 * is another campaign. A success is kept as `adopted` until a dialog has shown it; every other entry
 * is dropped once an answer settles it (a definite refusal, or a check). A full-page navigation
 * (sign-out) tears the instance down.
 */
@Injectable({ providedIn: 'root' })
export class CampaignAdoptionStateService {
  private readonly state = signal<Readonly<Record<string, CampaignAdoptionInFlight>>>({});

  public static key(projectSlug: string, platform: string, platformCampaignId: string): string {
    return JSON.stringify([projectSlug, platform, platformCampaignId]);
  }

  /** The unsettled adoption for one campaign, or `null`. */
  public entry(key: string): Signal<CampaignAdoptionInFlight | null> {
    return computed(() => (Object.prototype.hasOwnProperty.call(this.state(), key) ? this.state()[key] : null));
  }

  public markPending(key: string, briefId: string): void {
    this.state.update((s) => ({ ...s, [key]: { state: 'pending', briefId, failure: null } }));
  }

  /** A success that may land after its dialog closed: kept until a dialog shows it, so none re-offers Adopt. */
  public markAdopted(key: string, briefId: string): void {
    this.state.update((s) => ({ ...s, [key]: { state: 'adopted', briefId, failure: null, adoptedAt: new Date().toISOString() } }));
  }

  public markUnconfirmed(key: string, briefId: string, failure: CampaignAdoptFailure): void {
    this.state.update((s) => ({ ...s, [key]: { state: 'unconfirmed', briefId, failure } }));
  }

  /** Adds a note under an unconfirmed adoption (a check that could not settle it). */
  public annotate(key: string, detail: string): void {
    this.state.update((s) => {
      const current = Object.prototype.hasOwnProperty.call(s, key) ? s[key] : undefined;
      if (!current?.failure) {
        return s;
      }
      return { ...s, [key]: { ...current, failure: { ...current.failure, detail } } };
    });
  }

  /** The adoption is settled: adopted, definitely refused, or proved not to have happened. */
  public settle(key: string): void {
    this.state.update((s) => {
      if (!Object.prototype.hasOwnProperty.call(s, key)) {
        return s;
      }
      const next = { ...s };
      delete next[key];
      return next;
    });
  }
}
