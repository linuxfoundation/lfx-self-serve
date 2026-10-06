// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED, MAX_NEGATIVE_KEYWORDS_PER_REQUEST } from '@lfx-one/shared/constants';
import { CampaignNegativeKeywordsResult } from '@lfx-one/shared/interfaces';
import { CampaignNegativeKeywordsService } from '@services/campaign-negative-keywords.service';
import { CampaignService } from '@services/campaign.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignNegativeKeywordsFormComponent } from './campaign-negative-keywords-form.component';

describe('CampaignNegativeKeywordsFormComponent', () => {
  let fixture: ComponentFixture<CampaignNegativeKeywordsFormComponent>;
  let addNegativeKeywords: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    addNegativeKeywords = vi.fn();
    messageAdd = vi.fn();
    await TestBed.configureTestingModule({
      imports: [CampaignNegativeKeywordsFormComponent],
      providers: [
        provideNoopAnimations(),
        { provide: CampaignService, useValue: { addNegativeKeywords } },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CampaignNegativeKeywordsFormComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('briefId', 'b-1');
    fixture.componentRef.setInput('campaignId', 'c-1');
    fixture.componentRef.setInput('campaignName', 'KubeCon EU');
    fixture.detectChanges();
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = (testId: string): HTMLElement | null => el().querySelector(`[data-testid="${testId}"]`);

  function typeKeywords(value: string): void {
    const textarea = el().querySelector('#campaign-negatives-keywords-c-1') as HTMLTextAreaElement;
    textarea.value = value;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submit(): void {
    q('optimization-campaign-negatives-form-c-1')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('labels the field and groups the match type under a legend', () => {
    expect(el().querySelector('label[for="campaign-negatives-keywords-c-1"]')).not.toBeNull();
    expect(el().querySelector('fieldset legend')!.textContent).toContain('Match type');
    expect(el().querySelector('label[for="campaign-negatives-type-c-1-Exact"]')).not.toBeNull();
    expect(el().querySelector('label[for="campaign-negatives-type-c-1-Phrase"]')).not.toBeNull();
  });

  it('sends one keyword per line with the chosen match type, through the BFF', () => {
    addNegativeKeywords.mockReturnValue(of({ campaignId: 'c-1', appliedCount: 2, results: [] }));
    typeKeywords('free download\n\ncheap  tickets');
    (el().querySelector('#campaign-negatives-type-c-1-Phrase') as HTMLInputElement).click();
    fixture.detectChanges();
    submit();

    expect(addNegativeKeywords).toHaveBeenCalledWith('tlf', 'b-1', 'c-1', [
      { text: 'free download', matchType: 'Phrase' },
      { text: 'cheap tickets', matchType: 'Phrase' },
    ]);
  });

  it('refuses an empty submit and says why', () => {
    submit();

    expect(addNegativeKeywords).not.toHaveBeenCalled();
    expect(q('optimization-campaign-negatives-error-c-1')!.textContent).toContain('at least one keyword');
  });

  it('names each line that cannot be sent and sends nothing', () => {
    typeKeywords('fine\nnot ok!\nfoo..bar');
    submit();

    expect(addNegativeKeywords).not.toHaveBeenCalled();
    expect(q('optimization-campaign-negatives-line-error-2')!.textContent).toContain('Line 2');
    expect(q('optimization-campaign-negatives-line-error-3')!.textContent).toContain('punctuation');
    expect(el().querySelector('#campaign-negatives-keywords-c-1')!.getAttribute('aria-describedby')).toContain('campaign-negatives-keywords-error-c-1');
  });

  it(`refuses more than ${MAX_NEGATIVE_KEYWORDS_PER_REQUEST} keywords`, () => {
    typeKeywords(Array.from({ length: MAX_NEGATIVE_KEYWORDS_PER_REQUEST + 1 }, (_, i) => `kw ${i}`).join('\n'));
    submit();

    expect(addNegativeKeywords).not.toHaveBeenCalled();
    expect(q('optimization-campaign-negatives-error-c-1')!.textContent).toContain(`at most ${MAX_NEGATIVE_KEYWORDS_PER_REQUEST}`);
  });

  // POSITIONAL: results[i] answers the i-th keyword sent, and the list keeps that order.
  it('renders each outcome against the keyword sent at the same position', () => {
    const response: CampaignNegativeKeywordsResult = {
      campaignId: 'c-1',
      appliedCount: 2,
      results: [
        { text: 'alpha', matchType: 'Exact', outcome: 'APPLIED', negativeKeywordId: '1' },
        { text: 'beta', matchType: 'Exact', outcome: 'ALREADY_PRESENT' },
        { text: 'gamma', matchType: 'Exact', outcome: 'FAILED', errorCode: 'InvalidNegativeKeyword' },
        { text: 'delta', matchType: 'Exact', outcome: 'UNCONFIRMED' },
      ],
    };
    addNegativeKeywords.mockReturnValue(of(response));
    typeKeywords('alpha\nbeta\ngamma\ndelta');
    submit();

    const items = Array.from(el().querySelectorAll('[data-testid^="optimization-campaign-negatives-result-"]'));
    expect(items.map((item) => item.querySelector('[data-outcome]')!.getAttribute('data-outcome'))).toEqual([
      'APPLIED',
      'ALREADY_PRESENT',
      'FAILED',
      'UNCONFIRMED',
    ]);
    expect(items.map((item) => item.querySelector('.font-medium')!.textContent!.trim())).toEqual(['alpha', 'beta', 'gamma', 'delta']);
    expect(items[2].textContent).toContain('InvalidNegativeKeyword');
    // UNCONFIRMED is never worded as a failure, and tells the operator to verify first.
    expect(items[3].textContent).toContain('Not confirmed');
    expect(items[3].textContent).toContain('before retrying');
    expect(items[3].textContent).not.toContain('Not added');
    // Something did not settle, so the text is kept for the operator and the toast is sticky.
    expect((el().querySelector('#campaign-negatives-keywords-c-1') as HTMLTextAreaElement).value).toContain('alpha');
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', sticky: true }));
  });

  it('clears the field after every keyword is added or already present', () => {
    addNegativeKeywords.mockReturnValue(
      of({
        campaignId: 'c-1',
        appliedCount: 2,
        results: [
          { text: 'a', matchType: 'Exact', outcome: 'APPLIED' },
          { text: 'b', matchType: 'Exact', outcome: 'ALREADY_PRESENT' },
        ],
      })
    );
    typeKeywords('a\nb');
    submit();

    expect(fixture.componentInstance.form.controls.keywords.value).toBe('');
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: '1 added, 1 already present.' }));
  });

  it('reports an unreadable confirmation as "may have been added", naming the keywords sent', () => {
    addNegativeKeywords.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 502, error: { error: CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED, code: 'BAD_GATEWAY' } }))
    );
    typeKeywords('alpha\nbeta');
    submit();

    const unconfirmed = q('optimization-campaign-negatives-unconfirmed-c-1')!;
    expect(unconfirmed.textContent).toContain('may have been added');
    expect(unconfirmed.textContent).toContain('alpha, beta');
    expect(q('optimization-campaign-negatives-failed-c-1')).toBeNull();
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', sticky: true }));
  });

  it('shows a refusal verbatim as a failure', () => {
    const message = 'negative keywords can be added to Microsoft Advertising campaigns only';
    addNegativeKeywords.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { error: message, code: 'BAD_REQUEST' } })));
    typeKeywords('alpha');
    submit();

    expect(q('optimization-campaign-negatives-failed-c-1')!.textContent!.trim()).toBe(message);
    expect(q('optimization-campaign-negatives-unconfirmed-c-1')).toBeNull();
  });

  it('shows pending while a request runs, then the outcome', () => {
    const response = new Subject<CampaignNegativeKeywordsResult>();
    addNegativeKeywords.mockReturnValue(response);
    typeKeywords('alpha');
    submit();

    expect(TestBed.inject(CampaignNegativeKeywordsService).requests()['tlf|b-1|c-1'].pending).toBe(true);
    response.error(new HttpErrorResponse({ status: 504, error: 'upstream request timeout' }));
    fixture.detectChanges();

    expect(TestBed.inject(CampaignNegativeKeywordsService).requests()['tlf|b-1|c-1'].pending).toBe(false);
    // A proxy's plain-text timeout is not the BFF's envelope: the keywords may have been added.
    expect(q('optimization-campaign-negatives-unconfirmed-c-1')!.textContent).toContain('alpha');
  });

  // A campaign-list re-read or a tab switch destroys the form while the request runs on. The
  // request and its per-keyword outcomes must survive that, or the operator cannot tell which
  // keywords are safe to resend, and the parent's pending flag is never cleared.
  it('keeps the request and its per-keyword outcomes across a remount', () => {
    const response = new Subject<CampaignNegativeKeywordsResult>();
    addNegativeKeywords.mockReturnValue(response);
    typeKeywords('alpha\nbeta');
    submit();
    fixture.destroy();

    const remounted = TestBed.createComponent(CampaignNegativeKeywordsFormComponent);
    remounted.componentRef.setInput('projectSlug', 'tlf');
    remounted.componentRef.setInput('briefId', 'b-1');
    remounted.componentRef.setInput('campaignId', 'c-1');
    remounted.componentRef.setInput('campaignName', 'KubeCon EU');
    remounted.detectChanges();
    const root = remounted.nativeElement as HTMLElement;
    const submitButton = root.querySelector('[data-testid="optimization-campaign-negatives-submit-c-1"] button') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    response.next({
      campaignId: 'c-1',
      appliedCount: 1,
      results: [
        { text: 'alpha', matchType: 'Exact', outcome: 'APPLIED' },
        { text: 'beta', matchType: 'Exact', outcome: 'UNCONFIRMED' },
      ],
    });
    response.complete();
    remounted.detectChanges();

    expect(TestBed.inject(CampaignNegativeKeywordsService).requests()['tlf|b-1|c-1'].pending).toBe(false);
    const items = Array.from(root.querySelectorAll('[data-testid^="optimization-campaign-negatives-result-"]'));
    expect(items.map((item) => item.querySelector('[data-outcome]')!.getAttribute('data-outcome'))).toEqual(['APPLIED', 'UNCONFIRMED']);
    expect(items.map((item) => item.querySelector('.font-medium')!.textContent!.trim())).toEqual(['alpha', 'beta']);
    // Remounted mid-flight with an empty field: the unconfirmed keyword comes back once it settles.
    expect(remounted.componentInstance.form.controls.keywords.value).toBe('beta');
    expect(messageAdd).toHaveBeenCalledTimes(1);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', sticky: true, detail: expect.stringContaining('to see which') }));
  });

  // The remounted editor gets back what its predecessor held: the keywords NOT confirmed added, in
  // the order sent, and the match type, so the operator can resend them without retyping.
  it('restores the keywords not confirmed added, and the match type, into a remounted editor', () => {
    addNegativeKeywords.mockReturnValue(
      of({
        campaignId: 'c-1',
        appliedCount: 1,
        results: [
          { text: 'alpha', matchType: 'Phrase', outcome: 'FAILED' },
          { text: 'beta', matchType: 'Phrase', outcome: 'APPLIED' },
          { text: 'gamma', matchType: 'Phrase', outcome: 'UNCONFIRMED' },
        ],
      })
    );
    typeKeywords('alpha\nbeta\ngamma');
    (el().querySelector('#campaign-negatives-type-c-1-Phrase') as HTMLInputElement).click();
    fixture.detectChanges();
    submit();
    fixture.destroy();

    const remounted = TestBed.createComponent(CampaignNegativeKeywordsFormComponent);
    remounted.componentRef.setInput('projectSlug', 'tlf');
    remounted.componentRef.setInput('briefId', 'b-1');
    remounted.componentRef.setInput('campaignId', 'c-1');
    remounted.componentRef.setInput('campaignName', 'KubeCon EU');
    remounted.detectChanges();

    expect(remounted.componentInstance.form.getRawValue()).toEqual({ keywords: 'alpha\ngamma', matchType: 'Phrase' });
  });

  it('restores nothing into a remounted editor after every keyword was added', () => {
    addNegativeKeywords.mockReturnValue(of({ campaignId: 'c-1', appliedCount: 1, results: [{ text: 'alpha', matchType: 'Exact', outcome: 'APPLIED' }] }));
    typeKeywords('alpha');
    submit();
    fixture.destroy();

    const remounted = TestBed.createComponent(CampaignNegativeKeywordsFormComponent);
    remounted.componentRef.setInput('projectSlug', 'tlf');
    remounted.componentRef.setInput('briefId', 'b-1');
    remounted.componentRef.setInput('campaignId', 'c-1');
    remounted.componentRef.setInput('campaignName', 'KubeCon EU');
    remounted.detectChanges();

    expect(remounted.componentInstance.form.controls.keywords.value).toBe('');
  });
});
