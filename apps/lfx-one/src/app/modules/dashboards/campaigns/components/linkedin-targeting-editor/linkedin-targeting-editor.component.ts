// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { LINKEDIN_TARGETING_LIMITS } from '@lfx-one/shared/constants';
import type { LinkedInTargetingDraft, LinkedInTargetingFacetPicks } from '@lfx-one/shared/interfaces';
import { linkedInTargetingCanAddClause, linkedInTargetingDraftRefusal, linkedInTargetingMergedPicks } from '@lfx-one/shared/utils';

import { LinkedInTargetingFacetGroupComponent } from '../linkedin-targeting-facet-group/linkedin-targeting-facet-group.component';

/**
 * LinkedIn custom targeting on the Implement tab (#5764 rows 8–11): include clauses (people match every clause, and
 * any value within one) and exclusions, which replace the targeting profile. The parent owns the draft, sends it as
 * `linkedInConfig.targeting`, and holds Create while the refusal shown here stands. The rules live in
 * `campaign-linkedin-targeting-form.utils.ts`.
 */
@Component({
  selector: 'lfx-linkedin-targeting-editor',
  imports: [ButtonComponent, LinkedInTargetingFacetGroupComponent],
  templateUrl: './linkedin-targeting-editor.component.html',
})
export class LinkedInTargetingEditorComponent {
  public readonly projectSlug = input.required<string>();
  public readonly draft = model.required<LinkedInTargetingDraft>();

  protected readonly maxClauses = LINKEDIN_TARGETING_LIMITS.clauses;
  protected readonly canAddClause = computed(() => linkedInTargetingCanAddClause(this.draft()));
  protected readonly refusal = computed(() => linkedInTargetingDraftRefusal(this.draft()));
  /** What the clauses include, which the exclusions do not offer. */
  protected readonly included = computed(() => linkedInTargetingMergedPicks(...this.draft().clauses));

  /**
   * A key per clause, so removing one drops that clause's group (and its facet choice and search) rather than handing
   * them to the clause that moves into its place. Clauses carry no id in the draft; a clause added gets a new key, and a
   * restored draft of another length is re-keyed.
   */
  private nextClauseKey = 0;
  private keys: number[] = [];
  protected readonly clauseKeys = computed<number[]>(() => {
    const count = this.draft().clauses.length;
    while (this.keys.length < count) this.keys.push(this.nextClauseKey++);
    if (this.keys.length > count) this.keys = this.keys.slice(0, count);
    return [...this.keys];
  });

  protected onClauseChange(index: number, picks: LinkedInTargetingFacetPicks): void {
    this.draft.update((draft) => ({ ...draft, clauses: draft.clauses.map((clause, i) => (i === index ? picks : clause)) }));
  }

  protected onExcludeChange(picks: LinkedInTargetingFacetPicks): void {
    this.draft.update((draft) => ({ ...draft, exclude: picks }));
  }

  protected addClause(): void {
    if (this.canAddClause()) this.draft.update((draft) => ({ ...draft, clauses: [...draft.clauses, {}] }));
  }

  protected removeClause(index: number): void {
    if (this.draft().clauses.length > 1) this.keys = this.keys.filter((_, i) => i !== index);
    this.draft.update((draft) => (draft.clauses.length <= 1 ? draft : { ...draft, clauses: draft.clauses.filter((_, i) => i !== index) }));
  }
}
