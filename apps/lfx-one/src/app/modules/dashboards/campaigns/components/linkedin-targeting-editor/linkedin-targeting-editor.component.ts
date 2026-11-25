// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { LINKEDIN_TARGETING_LIMITS } from '@lfx-one/shared/constants';
import type { LinkedInTargetingDraft, LinkedInTargetingFacetPicks } from '@lfx-one/shared/interfaces';
import { linkedInTargetingCanAddClause, linkedInTargetingDraftRefusal } from '@lfx-one/shared/utils';

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
    this.draft.update((draft) => (draft.clauses.length <= 1 ? draft : { ...draft, clauses: draft.clauses.filter((_, i) => i !== index) }));
  }
}
