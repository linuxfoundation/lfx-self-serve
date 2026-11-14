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
 * reason as `CampaignNegativeKeywordsService`, and bounded by the campaigns page
 * (`CampaignsComponent`), which reports its project through `setScope` and calls `releaseScope`
 * when it is destroyed.
 *
 * Scoped by PROJECT only, because the keyword table it serves is project-level (it reads the
 * project's ad account, not a brief): a brief id appearing, changing or going empty during a save
 * says nothing about which keywords exist. A project change or leaving the page forgets everything,
 * and a removal is recorded only if the project it was sent from is still the page's — Microsoft ids
 * are per ad account, so an identity from one project could otherwise hide another's controls.
 * Sign-out needs no reset: `/logout` is a full-page navigation that tears down this root instance.
 */
@Injectable({ providedIn: 'root' })
export class CampaignRemovedKeywordsService {
  private readonly state = signal<ReadonlySet<string>>(new Set<string>());
  /** The campaigns page's project; `undefined` until `setScope` is first called, `null` once released. */
  private activeProject: string | null | undefined = undefined;

  public readonly removed: Signal<ReadonlySet<string>> = this.state.asReadonly();

  /** Records a keyword a confirmed REMOVE deleted, unless the page has since left the project it was sent from. */
  public markRemoved(projectSlug: string, identity: string): void {
    if (this.activeProject === null || (this.activeProject !== undefined && projectSlug !== this.activeProject)) {
      return;
    }
    if (this.state().has(identity)) {
      return;
    }
    this.state.update((removed) => new Set(removed).add(identity));
  }

  /** Called by the campaigns page whenever its project changes; a change forgets everything. */
  public setScope(projectSlug: string): void {
    if (projectSlug === this.activeProject) {
      return;
    }
    const first = this.activeProject === undefined;
    this.activeProject = projectSlug;
    if (!first) {
      this.state.set(new Set<string>());
    }
  }

  /** Called when the campaigns page is destroyed. */
  public releaseScope(): void {
    this.activeProject = null;
    this.state.set(new Set<string>());
  }
}
