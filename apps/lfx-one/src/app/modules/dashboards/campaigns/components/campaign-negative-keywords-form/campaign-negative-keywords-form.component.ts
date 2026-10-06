// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, Signal, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { CAMPAIGN_NEGATIVE_KEYWORD_MATCH_TYPE_OPTIONS, MAX_NEGATIVE_KEYWORDS_PER_REQUEST } from '@lfx-one/shared/constants';
import type {
  CampaignNegativeKeywordMatchType,
  CampaignNegativeKeywordOutcomeRow,
  CampaignNegativeKeywordsBatchOutcome,
  NegativeKeywordInputProblem,
} from '@lfx-one/shared/interfaces';
import { parseNegativeKeywordInput } from '@lfx-one/shared/utils';
import { campaignNegativeKeywordsValidator } from '@lfx-one/shared/validators';
import { CampaignService } from '@services/campaign.service';
import {
  campaignNegativeKeywordsFailureOutcome,
  negativeKeywordOutcomeRows,
  summarizeNegativeKeywordOutcomes,
} from '@shared/utils/campaign-negative-keywords.utils';
import { controlTouchedSignal, controlValueSignal, touchedErrorSignal, touchedInvalidSignal } from '@shared/utils/form-control-signals.util';
import { MessageService } from 'primeng/api';
import { take } from 'rxjs';

/**
 * Adds campaign-level negative keywords to one Microsoft Advertising campaign from the Optimize tab.
 *
 * Unlike the budget and bid editors this one owns its request: the lever persists nothing on the
 * campaign row and takes no ETag, so there is no validator to share with the row's other writes.
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
  private readonly campaignService = inject(CampaignService);
  // App-root: the toast is what carries an outcome past this component's destruction.
  private readonly messageService = inject(MessageService);

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

  protected readonly pending = signal(false);
  /** Per-keyword outcomes of the last request, in the order the keywords were SENT. */
  protected readonly outcomeRows = signal<CampaignNegativeKeywordOutcomeRow[]>([]);
  /** The last request's outcome when it produced no per-keyword results at all. */
  protected readonly batchOutcome = signal<CampaignNegativeKeywordsBatchOutcome | null>(null);
  /** The keywords of the request the batch outcome is about, so an unconfirmed batch can name them. */
  protected readonly batchKeywords = signal<string[]>([]);

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
    const sent = parseNegativeKeywordInput(text).keywords;
    const campaignName = this.campaignName();

    this.pending.set(true);
    this.outcomeRows.set([]);
    this.batchOutcome.set(null);
    this.batchKeywords.set([]);

    // `take(1)`, not `takeUntilDestroyed`: the parent tab can be destroyed by a tab switch, and
    // aborting the request would lose the outcome of keywords that may already have been added.
    this.campaignService
      .addNegativeKeywords(
        this.projectSlug(),
        this.briefId(),
        this.campaignId(),
        sent.map((kw) => ({ text: kw, matchType }))
      )
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          const rows = negativeKeywordOutcomeRows(sent, matchType, result);
          this.pending.set(false);
          this.outcomeRows.set(rows);
          if (!rows.some((row) => row.outcome === 'FAILED' || row.outcome === 'UNCONFIRMED')) {
            this.form.controls.keywords.reset('');
          }
          this.announceResult(campaignName, rows);
        },
        error: (err: unknown) => {
          const outcome = campaignNegativeKeywordsFailureOutcome(err);
          this.pending.set(false);
          this.batchOutcome.set(outcome);
          this.batchKeywords.set(sent);
          this.messageService.add({
            severity: outcome.state === 'unconfirmed' ? 'warn' : 'error',
            summary: outcome.state === 'unconfirmed' ? `Negative keywords not confirmed for ${campaignName}` : `Negative keywords not added to ${campaignName}`,
            detail: outcome.message,
            sticky: true,
          });
        },
      });
  }

  /** One toast for the whole request; the per-keyword detail stays in the list. */
  private announceResult(campaignName: string, rows: CampaignNegativeKeywordOutcomeRow[]): void {
    const unsettled = rows.some((row) => row.outcome === 'FAILED' || row.outcome === 'UNCONFIRMED');
    const unconfirmed = rows.some((row) => row.outcome === 'UNCONFIRMED');
    let severity: 'success' | 'warn' | 'error' = 'success';
    if (unconfirmed) {
      severity = 'warn';
    } else if (unsettled) {
      severity = 'error';
    }
    this.messageService.add({
      severity,
      summary: `Negative keywords for ${campaignName}`,
      detail: summarizeNegativeKeywordOutcomes(rows),
      ...(unsettled ? { sticky: true } : { life: 5000 }),
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
