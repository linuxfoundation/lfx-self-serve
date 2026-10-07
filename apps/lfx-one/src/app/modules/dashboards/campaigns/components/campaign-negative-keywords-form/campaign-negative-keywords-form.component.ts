// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, output, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { CAMPAIGN_NEGATIVE_KEYWORD_MATCH_TYPE_OPTIONS, MAX_NEGATIVE_KEYWORDS_PER_REQUEST } from '@lfx-one/shared/constants';
import type {
  CampaignNegativeKeywordMatchType,
  CampaignNegativeKeywordOutcomeRow,
  CampaignNegativeKeywordsBatchOutcome,
  CampaignNegativeKeywordsRequestState,
  NegativeKeywordInputProblem,
} from '@lfx-one/shared/interfaces';
import { parseNegativeKeywordInput } from '@lfx-one/shared/utils';
import { campaignNegativeKeywordsValidator } from '@lfx-one/shared/validators';
import { CampaignNegativeKeywordsService } from '@services/campaign-negative-keywords.service';
import { campaignNegativeKeywordsKey, summarizeNegativeKeywordOutcomes } from '@shared/utils/campaign-negative-keywords.utils';
import { controlTouchedSignal, controlValueSignal, touchedErrorSignal, touchedInvalidSignal } from '@shared/utils/form-control-signals.util';
import { filter, take } from 'rxjs';

/**
 * Adds campaign-level negative keywords to one Microsoft Advertising campaign from the Optimize tab.
 *
 * Unlike the budget and bid editors this one takes no ETag: the lever persists nothing on the
 * campaign row, so there is no validator to share with the row's other writes.
 *
 * The request and its outcomes live in the root `CampaignNegativeKeywordsService`, not here: this
 * form is destroyed by a tab switch or a campaign-list re-read while the request runs on, and a
 * remounted form must show what that request answered (and that it is still running).
 *
 * The response is NOT atomic and is POSITIONAL: `results[i]` answers the i-th keyword sent, each
 * with its own outcome. The outcomes are therefore zipped onto the exact list that was sent and
 * rendered in that order — never matched by text, filtered or re-sorted. UNCONFIRMED is never shown
 * as a failure: that keyword may already be on the campaign, and the operator verifies first.
 */
@Component({
  selector: 'lfx-campaign-negative-keywords-form',
  imports: [ReactiveFormsModule, ButtonComponent, RadioButtonComponent, TextareaComponent],
  templateUrl: './campaign-negative-keywords-form.component.html',
  styleUrl: './campaign-negative-keywords-form.component.scss',
})
export class CampaignNegativeKeywordsFormComponent {
  private readonly negativeKeywordsService = inject(CampaignNegativeKeywordsService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly projectSlug = input.required<string>();
  public readonly briefId = input.required<string>();
  public readonly campaignId = input.required<string>();
  public readonly campaignName = input.required<string>();

  public readonly cancelEdit = output<void>();

  public readonly form = new FormGroup({
    keywords: new FormControl<string>('', { nonNullable: true, validators: [campaignNegativeKeywordsValidator()] }),
    // Exact is the narrowest a negative can be, so it is the default that blocks the least traffic.
    matchType: new FormControl<CampaignNegativeKeywordMatchType>('Exact', { nonNullable: true, validators: [Validators.required] }),
  });

  protected readonly matchTypeOptions = CAMPAIGN_NEGATIVE_KEYWORD_MATCH_TYPE_OPTIONS;
  protected readonly maxKeywords = MAX_NEGATIVE_KEYWORDS_PER_REQUEST;

  /** This campaign's latest request, which outlives this form. `null` before the first one. */
  private readonly request: Signal<CampaignNegativeKeywordsRequestState | null> = computed(
    () => this.negativeKeywordsService.requests()[campaignNegativeKeywordsKey(this.projectSlug(), this.briefId(), this.campaignId())] ?? null
  );
  protected readonly pending: Signal<boolean> = computed(() => this.request()?.pending ?? false);
  /** Per-keyword outcomes of the last request, in the order the keywords were SENT. */
  protected readonly outcomeRows: Signal<CampaignNegativeKeywordOutcomeRow[]> = computed(() => this.request()?.outcomeRows ?? []);
  /** The last request's outcome when it produced no per-keyword results at all. */
  protected readonly batchOutcome: Signal<CampaignNegativeKeywordsBatchOutcome | null> = computed(() => this.request()?.batchOutcome ?? null);
  /** The keywords of the request the batch outcome is about, so an unconfirmed batch can name them. */
  protected readonly batchKeywordsText: Signal<string> = computed(() => (this.request()?.batchKeywords ?? []).join(', '));

  protected readonly ids = computed(() => {
    const id = this.campaignId();
    return {
      keywords: `campaign-negatives-keywords-${id}`,
      keywordsHint: `campaign-negatives-keywords-hint-${id}`,
      keywordsError: `campaign-negatives-keywords-error-${id}`,
      typeName: `campaign-negatives-type-${id}`,
      typeHint: `campaign-negatives-type-hint-${id}`,
    };
  });

  private readonly keywordsText: Signal<string | null> = controlValueSignal<string>(
    computed(() => this.form),
    'keywords'
  );
  private readonly keywordsTouched: Signal<boolean> = controlTouchedSignal(
    computed(() => this.form),
    'keywords'
  );
  private readonly keywordsRequired: Signal<boolean> = touchedErrorSignal(
    computed(() => this.form),
    'keywords',
    'negativeKeywordsRequired'
  );
  protected readonly keywordsInvalid: Signal<boolean> = touchedInvalidSignal(
    computed(() => this.form),
    'keywords'
  );

  /** How many keywords the text holds right now, for the live counter. */
  protected readonly keywordCount: Signal<number> = computed(() => parseNegativeKeywordInput(this.keywordsText()).keywords.length);
  /** The lines that cannot be sent, shown once the field has been left or a submit was tried. */
  protected readonly lineProblems: Signal<NegativeKeywordInputProblem[]> = computed(() =>
    this.keywordsTouched() ? parseNegativeKeywordInput(this.keywordsText()).problems : []
  );
  /** The field-level message (none, too many), or `''`. Line problems are listed separately. */
  protected readonly keywordsError: Signal<string> = this.initKeywordsError();
  protected readonly keywordsDescribedBy: Signal<string> = computed(() => {
    const ids = this.ids();
    return this.keywordsError() !== '' || this.lineProblems().length > 0 ? `${ids.keywordsHint} ${ids.keywordsError}` : ids.keywordsHint;
  });
  protected readonly outcomeSummary: Signal<string> = this.initOutcomeSummary();
  protected readonly pendingAnnouncement = computed(() => (this.pending() ? `Adding negative keywords to ${this.campaignName()}` : ''));
  protected readonly submitLabel = computed(() => `Add negative keywords to ${this.campaignName()}`);

  public constructor() {
    this.initRestoreUnsettledInput();
  }

  protected submit(): void {
    if (this.pending()) {
      return;
    }
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }
    const { keywords: text, matchType } = this.form.getRawValue();
    // The SAME list the outcomes are zipped onto: parsed once, sent as-is, rendered by index.
    const keywords = parseNegativeKeywordInput(text).keywords;

    this.negativeKeywordsService.submit(
      {
        projectSlug: this.projectSlug(),
        briefId: this.briefId(),
        campaignId: this.campaignId(),
        campaignName: this.campaignName(),
        keywords,
        matchType,
      },
      // Every keyword added or already present: nothing left to resend. A form destroyed meanwhile
      // has no input to clear.
      () => {
        if (!this.destroyRef.destroyed) {
          this.form.controls.keywords.reset('');
        }
      }
    );
  }

  /**
   * A remounted editor gets back what it lost with its predecessor: the keywords of the last request
   * that were NOT confirmed added (refused or unconfirmed, in the order sent — the whole list when
   * the request produced no per-keyword results) and its match type, so the operator can resend
   * them after verifying instead of retyping.
   *
   * Once, at the first SETTLED state this form sees, and only into an empty field: the form that sent
   * the request still holds its own text, and an operator's new typing is never overwritten.
   */
  private initRestoreUnsettledInput(): void {
    toObservable(this.request)
      .pipe(
        filter((request): request is CampaignNegativeKeywordsRequestState => request !== null && !request.pending),
        take(1),
        takeUntilDestroyed()
      )
      .subscribe((request) => {
        const keywords = this.form.controls.keywords;
        if (keywords.value.trim() !== '') {
          return;
        }
        const unsettled =
          request.batchOutcome !== null
            ? request.sent
            : request.outcomeRows.filter((row) => row.outcome === 'FAILED' || row.outcome === 'UNCONFIRMED').map((row) => row.text);
        if (unsettled.length === 0) {
          return;
        }
        keywords.setValue(unsettled.join('\n'));
        this.form.controls.matchType.setValue(request.matchType);
      });
  }

  /** "2 added, 1 already present, 1 not confirmed" — counts of keywords only, in outcome order. */
  private initOutcomeSummary(): Signal<string> {
    return computed(() => summarizeNegativeKeywordOutcomes(this.outcomeRows()));
  }

  private initKeywordsError(): Signal<string> {
    return computed(() => {
      if (this.keywordsRequired()) {
        return 'Enter at least one keyword, one per line.';
      }
      const count = this.keywordCount();
      if (this.keywordsTouched() && count > this.maxKeywords) {
        return `Enter at most ${this.maxKeywords} keywords per request (${count} entered).`;
      }
      return '';
    });
  }
}
