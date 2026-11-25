// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, model, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { LINKEDIN_TARGETING_LIMITS } from '@lfx-one/shared/constants';
import type { LinkedInAudiencesState, LinkedInTargetingDraft, LinkedInTargetingFacetPicks } from '@lfx-one/shared/interfaces';
import {
  linkedInAudiencesFailure,
  linkedInTargetingCanAddClause,
  linkedInTargetingDraftRefusal,
  linkedInTargetingDraftWithoutSegments,
  linkedInTargetingDraftWithSegmentsAccount,
  linkedInTargetingMergedPicks,
  linkedInTargetingSegmentsAccountRefusal,
} from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { catchError, map, of, skip, startWith, switchMap } from 'rxjs';

import { LinkedInTargetingFacetGroupComponent } from '../linkedin-targeting-facet-group/linkedin-targeting-facet-group.component';

/**
 * LinkedIn custom targeting on the Implement tab (#5764 rows 8–11): include clauses (people match every clause, and
 * any value within one) and exclusions, which replace the targeting profile. The parent owns the draft, sends it as
 * `linkedInConfig.targeting`, and holds Create while the refusal shown here stands. The ad account's segments are read
 * here, once per project and account, for every group. The rules live in `campaign-linkedin-targeting-form.utils.ts`.
 */
@Component({
  selector: 'lfx-linkedin-targeting-editor',
  imports: [ButtonComponent, LinkedInTargetingFacetGroupComponent],
  templateUrl: './linkedin-targeting-editor.component.html',
})
export class LinkedInTargetingEditorComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly projectSlug = input.required<string>();
  /** The non-default LinkedIn ad account the create names (`selectedAdAccountId`), or `null` for the default. */
  public readonly accountId = input<string | null>(null);
  public readonly draft = model.required<LinkedInTargetingDraft>();

  /** Bumped by a group's "Try again", so a failed segment read runs again. */
  private readonly audiencesAttempt = signal(0);
  /** The ad account's segments, for every group's segment facets. */
  protected readonly audiences: Signal<LinkedInAudiencesState> = this.initAudiences();

  protected readonly maxClauses = LINKEDIN_TARGETING_LIMITS.clauses;
  protected readonly canAddClause = computed(() => linkedInTargetingCanAddClause(this.draft()));
  protected readonly refusal = computed(() => linkedInTargetingDraftRefusal(this.draft()));
  /** Why the segments picked cannot go to this account: they were picked for another one (the tab holds Create on it). */
  protected readonly segmentsRefusal = computed(() => linkedInTargetingSegmentsAccountRefusal(this.draft(), this.accountId()));
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

  public constructor() {
    // Segments belong to the ad account they were read from: when the create's account changes, the picks of the
    // previous one are dropped rather than sent with the new one. skip(1) leaves the first value (the account the
    // editor opened on, a restored draft included) alone. toObservable + subscribe per frontend-checklist §5.
    toObservable(this.accountId)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.draft.update(linkedInTargetingDraftWithoutSegments));
  }

  protected onClauseChange(index: number, picks: LinkedInTargetingFacetPicks): void {
    this.edit((draft) => ({ ...draft, clauses: draft.clauses.map((clause, i) => (i === index ? picks : clause)) }));
  }

  protected onExcludeChange(picks: LinkedInTargetingFacetPicks): void {
    this.edit((draft) => ({ ...draft, exclude: picks }));
  }

  protected retryAudiences(): void {
    this.audiencesAttempt.update((attempt) => attempt + 1);
  }

  protected addClause(): void {
    if (this.canAddClause()) this.draft.update((draft) => ({ ...draft, clauses: [...draft.clauses, {}] }));
  }

  protected removeClause(index: number): void {
    if (this.draft().clauses.length > 1) this.keys = this.keys.filter((_, i) => i !== index);
    this.draft.update((draft) => (draft.clauses.length <= 1 ? draft : { ...draft, clauses: draft.clauses.filter((_, i) => i !== index) }));
  }

  /**
   * The segment read, once per project and account (and again on "Try again"). The project and account are read INSIDE
   * the trigger, so a switch drops a read that no longer applies. A 403 is the caller's role, not a fault, so only
   * other failures are logged, by status.
   */
  private initAudiences(): Signal<LinkedInAudiencesState> {
    const loading: LinkedInAudiencesState = { status: 'loading', audiences: [], failure: null };
    const trigger = computed(() => ({ projectSlug: this.projectSlug(), accountId: this.accountId(), attempt: this.audiencesAttempt() }));
    return toSignal(
      toObservable(trigger).pipe(
        switchMap(({ projectSlug, accountId }) => {
          if (projectSlug === '') return of(loading);
          return this.campaignService.getLinkedInAudiences(projectSlug, accountId ?? undefined).pipe(
            map((result): LinkedInAudiencesState => ({ status: 'loaded', audiences: result.audiences, failure: null })),
            catchError((err: unknown) => {
              const status = err instanceof HttpErrorResponse ? err.status : 0;
              if (status !== 403) console.error('LinkedIn audience read failed:', status);
              return of(linkedInAudiencesFailure(status, err instanceof HttpErrorResponse ? err.error?.code : undefined));
            }),
            startWith(loading)
          );
        })
      ),
      { initialValue: loading }
    );
  }

  /** Applies a group's edit, recording the account its segments were picked for. */
  private edit(change: (draft: LinkedInTargetingDraft) => LinkedInTargetingDraft): void {
    this.draft.update((draft) => linkedInTargetingDraftWithSegmentsAccount(draft, change(draft), this.accountId()));
  }
}
