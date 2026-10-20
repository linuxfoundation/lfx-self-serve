// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, output, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES } from '@lfx-one/shared/constants';
import type {
  CampaignNegativeKeywordMatchType,
  CampaignNegativeKeywordMatchTypeOption,
  CampaignNegativeKeywordOutcomeRow,
  CampaignNegativeKeywordPlatformRules,
  CampaignNegativeKeywordsBatchOutcome,
  CampaignNegativeKeywordsRequestState,
  NegativeKeywordCampaignPlatform,
  NegativeKeywordInputProblem,
  NegativeKeywordsRevisionState,
} from '@lfx-one/shared/interfaces';
import { parseNegativeKeywordInput } from '@lfx-one/shared/utils';
import { campaignNegativeKeywordsValidator } from '@lfx-one/shared/validators';
import { CampaignNegativeKeywordsService } from '@services/campaign-negative-keywords.service';
import { CampaignService } from '@services/campaign.service';
import { campaignNegativeKeywordsKey, summarizeNegativeKeywordOutcomes } from '@shared/utils/campaign-negative-keywords.utils';
import { controlTouchedSignal, controlValueSignal, touchedErrorSignal, touchedInvalidSignal } from '@shared/utils/form-control-signals.util';
import { catchError, filter, map, of, startWith, switchMap, take } from 'rxjs';

/**
 * Adds negative keywords to one Google Ads, Microsoft Advertising, Reddit or X campaign from the
 * Optimize tab.
 *
 * What it offers follows the campaign's platform (`CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES`):
 * Microsoft Exact or Phrase, Google and X Exact, Phrase or Broad (X 20 per request, Google a
 * keyword text of at most 80 characters against the shared 100), Reddit Broad only. A Reddit
 * request must carry the `revision` of the ad group's targeting, so for Reddit the editor reads the
 * campaign's keyword targeting first, and again whenever a request for the campaign settles (the
 * write changes the fingerprint, and a 409 means it changed under us). While one is still in flight
 * (an editor reopened mid-request) it does not read at all: a revision read then would go stale the
 * moment the request lands. Nothing is sent until that read has answered.
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
  private readonly campaignService = inject(CampaignService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly projectSlug = input.required<string>();
  public readonly briefId = input.required<string>();
  public readonly campaignId = input.required<string>();
  public readonly campaignName = input.required<string>();
  /** The campaign's ad platform. Decides the match types, the cap, the wording and whether a revision is read and sent. */
  public readonly platform = input<NegativeKeywordCampaignPlatform>('microsoft-ads');

  public readonly cancelEdit = output<void>();

  // Before the form: its validator reads the caps on construction.
  protected readonly rules: Signal<CampaignNegativeKeywordPlatformRules> = computed(() => CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES[this.platform()]);
  protected readonly maxKeywords: Signal<number> = computed(() => this.rules().maxKeywords);
  /** The platform's own text limit, shorter than the shared one on Google Ads. */
  private readonly maxTextLength: Signal<number> = computed(() => this.rules().maxTextLength);
  protected readonly matchTypeOptions: Signal<readonly CampaignNegativeKeywordMatchTypeOption[]> = computed(() => this.rules().matchTypes);

  public readonly form = new FormGroup({
    keywords: new FormControl<string>('', {
      nonNullable: true,
      validators: [
        campaignNegativeKeywordsValidator(
          () => this.maxKeywords(),
          () => this.maxTextLength()
        ),
      ],
    }),
    // Exact is the narrowest a negative can be, so it is the default that blocks the least traffic
    // where the platform offers it; Reddit offers Broad only (see `initPlatformDefaults`).
    matchType: new FormControl<CampaignNegativeKeywordMatchType>('Exact', { nonNullable: true, validators: [Validators.required] }),
  });

  /** Bumped by Retry to read the Reddit revision again. A settled request re-reads on its own. */
  private readonly revisionReload = signal(0);

  /** This campaign's latest request, which outlives this form. `null` before the first one. */
  private readonly request: Signal<CampaignNegativeKeywordsRequestState | null> = computed(
    () => this.negativeKeywordsService.requests()[campaignNegativeKeywordsKey(this.projectSlug(), this.briefId(), this.campaignId())] ?? null
  );
  protected readonly pending: Signal<boolean> = computed(() => this.request()?.pending ?? false);
  /** Bumped by every settled request of this campaign: the targeting the revision fingerprints may have changed. */
  private readonly settleCount: Signal<number> = computed(() => this.request()?.settleCount ?? 0);
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
  protected readonly keywordCount: Signal<number> = computed(() => parseNegativeKeywordInput(this.keywordsText(), this.maxTextLength()).keywords.length);
  /** The lines that cannot be sent, shown once the field has been left or a submit was tried. */
  protected readonly lineProblems: Signal<NegativeKeywordInputProblem[]> = computed(() =>
    this.keywordsTouched() ? parseNegativeKeywordInput(this.keywordsText(), this.maxTextLength()).problems : []
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
  /** Reddit's revision, read from the campaign's keyword targeting; `idle` on the other platforms. */
  protected readonly revisionState: Signal<NegativeKeywordsRevisionState> = this.initRevisionState();
  /** Whether a request can be sent now: never while one is in flight, nor on Reddit before its revision is read. */
  protected readonly canSubmit: Signal<boolean> = computed(() => {
    if (this.pending()) {
      return false;
    }
    return !this.rules().requiresRevision || this.revisionState().status === 'ready';
  });

  public constructor() {
    this.initPlatformDefaults();
    this.initRestoreUnsettledInput();
  }

  protected retryRevision(): void {
    this.revisionReload.update((n) => n + 1);
  }

  protected submit(): void {
    if (!this.canSubmit()) {
      return;
    }
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }
    const { keywords: text, matchType } = this.form.getRawValue();
    // The SAME list the outcomes are zipped onto: parsed once, sent as-is, rendered by index.
    const keywords = parseNegativeKeywordInput(text, this.maxTextLength()).keywords;
    const revision = this.revisionState().revision;

    this.negativeKeywordsService.submit(
      {
        projectSlug: this.projectSlug(),
        briefId: this.briefId(),
        campaignId: this.campaignId(),
        campaignName: this.campaignName(),
        platform: this.platform(),
        keywords,
        matchType,
        // The service sends it to Reddit only; on any other platform it is dropped there.
        ...(revision !== null && { revision }),
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
    return computed(() => summarizeNegativeKeywordOutcomes(this.outcomeRows(), this.platform()));
  }

  /**
   * Keeps the match type one the platform takes (Reddit: Broad only) and re-checks the keyword text
   * against the new platform's caps, both of which differ by platform (X takes 20 keywords; Google
   * caps a keyword's text at 80). A match type restored from an earlier request is kept when valid.
   */
  private initPlatformDefaults(): void {
    toObservable(this.rules)
      .pipe(takeUntilDestroyed())
      .subscribe((rules) => {
        const matchType = this.form.controls.matchType;
        if (!rules.matchTypes.some((option) => option.value === matchType.value)) {
          matchType.setValue(rules.defaultMatchType);
        }
        this.form.controls.keywords.updateValueAndValidity();
      });
  }

  /**
   * Reddit's revision, from `get-keyword-targeting`. Only the revision is used: the read lists the
   * ad group's POSITIVE keywords, not its excluded ones. A read that answers without a revision is
   * an error here, since Reddit refuses an add without one. Read errors are not retried
   * automatically; the operator retries.
   *
   * Keyed on the campaign's shared request: nothing is read while one is in flight (shown as
   * loading), and every settled request (`settleCount`) reads again, so an editor reopened while an
   * earlier add ran can never hold a revision from before it.
   */
  private initRevisionState(): Signal<NegativeKeywordsRevisionState> {
    const idle: NegativeKeywordsRevisionState = { status: 'idle', revision: null };
    const request = computed(() => ({
      requiresRevision: this.rules().requiresRevision,
      projectSlug: this.projectSlug(),
      briefId: this.briefId(),
      campaignId: this.campaignId(),
      reload: this.revisionReload(),
      pending: this.pending(),
      settleCount: this.settleCount(),
    }));
    return toSignal(
      toObservable(request).pipe(
        switchMap(({ requiresRevision, projectSlug, briefId, campaignId, pending }) => {
          if (!requiresRevision) {
            return of(idle);
          }
          if (pending) {
            return of<NegativeKeywordsRevisionState>({ status: 'loading', revision: null });
          }
          return this.campaignService.getKeywordTargeting(projectSlug, briefId, campaignId).pipe(
            map(
              (targeting): NegativeKeywordsRevisionState =>
                typeof targeting?.revision === 'string' && targeting.revision !== ''
                  ? { status: 'ready', revision: targeting.revision }
                  : { status: 'error', revision: null }
            ),
            catchError(() => of<NegativeKeywordsRevisionState>({ status: 'error', revision: null })),
            startWith<NegativeKeywordsRevisionState>({ status: 'loading', revision: null })
          );
        })
      ),
      { initialValue: idle }
    );
  }

  private initKeywordsError(): Signal<string> {
    return computed(() => {
      if (this.keywordsRequired()) {
        return 'Enter at least one keyword, one per line.';
      }
      const count = this.keywordCount();
      if (this.keywordsTouched() && count > this.maxKeywords()) {
        return `Enter at most ${this.maxKeywords()} keywords per request (${count} entered).`;
      }
      return '';
    });
  }
}
