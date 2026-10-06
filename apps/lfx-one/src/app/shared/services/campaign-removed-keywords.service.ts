// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, Signal, signal } from '@angular/core';

/**
 * Remembers which keywords a confirmed REMOVE deleted on the campaigns page, by
 * `keywordIdentityKey(platform, campaignId, adGroupId, criterionId)`.
 *
 * A saved keyword report can still list a keyword after it is removed, so without this the table
 * would offer Pause and Remove again for a keyword that no longer exists. The Optimize tab cannot
 * hold it: the tab shell renders it inside `@case ('optimization')`, so every tab switch destroys
 * it, and a response landing after that would update a dead instance. Root-provided for the same
 * reason as `CampaignNegativeKeywordsService`, and bounded the same way: the campaigns page
 * (`CampaignsComponent`) reports its (project, brief) through `setScope` and calls `releaseScope`
 * when it is destroyed, and either one forgets every identity.
 *
 * Identities carry the platform's own campaign, ad group and keyword ids, so one recorded under a
 * scope that has since changed can never match a keyword in another. Sign-out needs no reset:
 * `/logout` is a full-page navigation that tears down this root instance.
 */
@Injectable({ providedIn: 'root' })
export class CampaignRemovedKeywordsService {
  private readonly state = signal<ReadonlySet<string>>(new Set<string>());
  /** The campaigns page's (project, brief); `undefined` until `setScope` is first called. */
  private activeScope: string | null | undefined = undefined;

  public readonly removed: Signal<ReadonlySet<string>> = this.state.asReadonly();

  /** Records a keyword a confirmed REMOVE deleted. */
  public markRemoved(identity: string): void {
    if (this.state().has(identity)) {
      return;
    }
    this.state.update((removed) => new Set(removed).add(identity));
  }

  /** Called by the campaigns page whenever its (project, brief) changes; a change forgets everything. */
  public setScope(projectSlug: string, briefId: string): void {
    const scope = `${projectSlug}\u0000${briefId}`;
    if (scope === this.activeScope) {
      return;
    }
    const first = this.activeScope === undefined;
    this.activeScope = scope;
    if (!first) {
      this.state.set(new Set<string>());
    }
  }

  /** Called when the campaigns page is destroyed. */
  public releaseScope(): void {
    this.activeScope = null;
    this.state.set(new Set<string>());
  }
}
