// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED,
  MAX_NEGATIVE_KEYWORDS_PER_REQUEST,
  MAX_X_NEGATIVE_KEYWORDS_PER_REQUEST,
} from '@lfx-one/shared/constants';
import { CampaignNegativeKeywordsResult, CampaignServiceKeywordTargeting } from '@lfx-one/shared/interfaces';
import { CampaignKeywordTargetingService } from '@services/campaign-keyword-targeting.service';
import { CampaignNegativeKeywordsService } from '@services/campaign-negative-keywords.service';
import { CampaignService } from '@services/campaign.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignNegativeKeywordsFormComponent } from './campaign-negative-keywords-form.component';

describe('CampaignNegativeKeywordsFormComponent', () => {
  let fixture: ComponentFixture<CampaignNegativeKeywordsFormComponent>;
  let addNegativeKeywords: ReturnType<typeof vi.fn>;
  let getKeywordTargeting: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    addNegativeKeywords = vi.fn();
    getKeywordTargeting = vi.fn();
    messageAdd = vi.fn();
    await TestBed.configureTestingModule({
      imports: [CampaignNegativeKeywordsFormComponent],
      providers: [
        provideNoopAnimations(),
        { provide: CampaignService, useValue: { addNegativeKeywords, getKeywordTargeting, removeKeywordTargeting: vi.fn().mockReturnValue(new Subject()) } },
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

    expect(addNegativeKeywords).toHaveBeenCalledWith(
      'tlf',
      'b-1',
      'c-1',
      [
        { text: 'free download', matchType: 'Phrase' },
        { text: 'cheap tickets', matchType: 'Phrase' },
      ],
      undefined
    );
    // Microsoft takes no revision, so the targeting is never read for one.
    expect(getKeywordTargeting).not.toHaveBeenCalled();
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

  describe('on Reddit and X', () => {
    const targeting = (revision?: string): CampaignServiceKeywordTargeting => ({
      campaign_id: 'c-1',
      platform: 'reddit-ads',
      targeting_entity_id: 'ag-1',
      keywords: [{ keyword: 'kubernetes' }],
      ...(revision !== undefined && { revision }),
    });

    function setPlatform(platform: 'reddit-ads' | 'twitter-ads'): void {
      fixture.componentRef.setInput('platform', platform);
      fixture.detectChanges();
    }

    const submitButton = (): HTMLButtonElement => el().querySelector('[data-testid="optimization-campaign-negatives-submit-c-1"] button') as HTMLButtonElement;

    it('offers Reddit Broad only, reads the revision, and sends it with the keywords', () => {
      getKeywordTargeting.mockReturnValue(of(targeting('sha256:r1')));
      addNegativeKeywords.mockReturnValue(of({ campaignId: 'c-1', appliedCount: 1, results: [{ text: 'free', matchType: 'Broad', outcome: 'APPLIED' }] }));
      setPlatform('reddit-ads');

      expect(getKeywordTargeting).toHaveBeenCalledWith('tlf', 'b-1', 'c-1');
      expect(el().querySelector('label[for="campaign-negatives-type-c-1-Broad"]')).not.toBeNull();
      expect(el().querySelector('label[for="campaign-negatives-type-c-1-Exact"]')).toBeNull();
      expect(fixture.componentInstance.form.controls.matchType.value).toBe('Broad');
      expect(q('optimization-campaign-negatives-keywords-c-1')!.closest('form')!.textContent).toContain('excluded keywords');

      typeKeywords('free');
      submit();

      expect(addNegativeKeywords).toHaveBeenCalledWith('tlf', 'b-1', 'c-1', [{ text: 'free', matchType: 'Broad' }], 'sha256:r1');
      // The write changed the fingerprint: the targeting is read again for the next request.
      expect(getKeywordTargeting).toHaveBeenCalledTimes(2);
    });

    // The Reddit keyword table holds the campaign while it reads the revision for its own add.
    // The table's add keeps its confirmed brief while the page's brief id goes empty (a Proceed save).
    it('holds submit under an empty brief id while an add to the campaign runs under its brief, then reads again', () => {
      getKeywordTargeting.mockReturnValue(of(targeting('sha256:r1')));
      setPlatform('reddit-ads');
      fixture.componentRef.setInput('briefId', '');
      fixture.detectChanges();
      const add = new Subject<CampaignNegativeKeywordsResult>();
      addNegativeKeywords.mockReturnValue(add);
      const service = TestBed.inject(CampaignNegativeKeywordsService);
      service.submit({
        projectSlug: 'tlf',
        briefId: 'b-1',
        campaignId: 'c-1',
        campaignName: 'KubeCon EU',
        platform: 'reddit-ads',
        keywords: ['free'],
        matchType: 'Broad',
        revision: 'sha256:r1',
      });
      fixture.detectChanges();
      expect(submitButton().disabled).toBe(true);
      expect(q('optimization-campaign-negatives-held-c-1')).not.toBeNull();
      const reads = getKeywordTargeting.mock.calls.length;

      add.next({ campaignId: 'c-1', appliedCount: 1, results: [{ text: 'free', matchType: 'Broad', outcome: 'APPLIED' }] });
      add.complete();
      fixture.detectChanges();

      expect(q('optimization-campaign-negatives-held-c-1')).toBeNull();
      expect(submitButton().disabled).toBe(false);
      // The add changed the fingerprint: the editor read its revision again.
      expect(getKeywordTargeting.mock.calls.length).toBe(reads + 1);
    });

    it('holds submit while the keyword table has the campaign reserved, and says why', () => {
      getKeywordTargeting.mockReturnValue(of(targeting('sha256:r1')));
      setPlatform('reddit-ads');
      const service = TestBed.inject(CampaignNegativeKeywordsService);
      expect(submitButton().disabled).toBe(false);

      service.reserve('tlf', 'c-1');
      fixture.detectChanges();
      expect(submitButton().disabled).toBe(true);
      expect(q('optimization-campaign-negatives-held-c-1')!.textContent).toContain('keyword table');
      typeKeywords('free');
      submit();
      expect(addNegativeKeywords).not.toHaveBeenCalled();

      service.release('tlf', 'c-1');
      fixture.detectChanges();
      expect(submitButton().disabled).toBe(false);
      expect(q('optimization-campaign-negatives-held-c-1')).toBeNull();
    });

    // A campaign's Reddit targeting is one domain, written one change at a time.
    it('holds submit while a keyword-targeting removal of the campaign is in flight', () => {
      getKeywordTargeting.mockReturnValue(of(targeting('sha256:r1')));
      setPlatform('reddit-ads');

      TestBed.inject(CampaignKeywordTargetingService).remove({
        projectSlug: 'tlf',
        briefId: 'b-1',
        campaignId: 'c-1',
        campaignName: 'KubeCon EU',
        platform: 'reddit-ads',
        request: { briefId: 'b-1', keywords: [{ keyword: 'kubernetes' }], revision: 'sha256:r1' },
        sent: ['kubernetes'],
      });
      fixture.detectChanges();

      expect(submitButton().disabled).toBe(true);
      expect(q('optimization-campaign-negatives-held-c-1')!.textContent).toContain('keyword targeting');
    });

    it('sends nothing to Reddit until the revision has been read, and offers a retry when the read fails', () => {
      const read = new Subject<CampaignServiceKeywordTargeting>();
      getKeywordTargeting.mockReturnValue(read);
      setPlatform('reddit-ads');

      expect(q('optimization-campaign-negatives-revision-loading-c-1')).not.toBeNull();
      expect(submitButton().disabled).toBe(true);
      typeKeywords('free');
      submit();
      expect(addNegativeKeywords).not.toHaveBeenCalled();

      read.error(new HttpErrorResponse({ status: 409, error: { error: 'unprovisioned', code: 'CONFLICT' } }));
      fixture.detectChanges();
      expect(q('optimization-campaign-negatives-revision-error-c-1')!.textContent).toContain("couldn't be read");
      // Upstream text is never shown.
      expect(q('optimization-campaign-negatives-revision-error-c-1')!.textContent).not.toContain('unprovisioned');
      expect(submitButton().disabled).toBe(true);

      getKeywordTargeting.mockReturnValue(of(targeting('sha256:r2')));
      (q('optimization-campaign-negatives-revision-retry-c-1')!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(submitButton().disabled).toBe(false);
    });

    // An editor reopened while an earlier Reddit add is still in flight must not read the revision
    // then: that revision goes stale the moment the add lands. It waits, and reads once it settles.
    it('reads no revision in an editor reopened mid-request, then reads once the request settles', () => {
      getKeywordTargeting.mockReturnValue(of(targeting('sha256:r1')));
      const pending = new Subject<CampaignNegativeKeywordsResult>();
      addNegativeKeywords.mockReturnValue(pending);
      setPlatform('reddit-ads');
      typeKeywords('free');
      submit();
      fixture.destroy();

      getKeywordTargeting.mockClear();
      getKeywordTargeting.mockReturnValue(of(targeting('sha256:r2')));
      const remounted = TestBed.createComponent(CampaignNegativeKeywordsFormComponent);
      remounted.componentRef.setInput('projectSlug', 'tlf');
      remounted.componentRef.setInput('briefId', 'b-1');
      remounted.componentRef.setInput('campaignId', 'c-1');
      remounted.componentRef.setInput('campaignName', 'KubeCon EU');
      remounted.componentRef.setInput('platform', 'reddit-ads');
      remounted.detectChanges();
      const root = remounted.nativeElement as HTMLElement;

      expect(getKeywordTargeting).not.toHaveBeenCalled();
      expect(root.querySelector('[data-testid="optimization-campaign-negatives-revision-loading-c-1"]')).not.toBeNull();

      pending.next({ campaignId: 'c-1', appliedCount: 1, results: [{ text: 'free', matchType: 'Broad', outcome: 'APPLIED' }] });
      pending.complete();
      remounted.detectChanges();

      expect(getKeywordTargeting).toHaveBeenCalledTimes(1);
      addNegativeKeywords.mockReturnValue(of({ campaignId: 'c-1', appliedCount: 0, results: [] }));
      const textarea = root.querySelector('#campaign-negatives-keywords-c-1') as HTMLTextAreaElement;
      textarea.value = 'torrent';
      textarea.dispatchEvent(new Event('input'));
      root.querySelector('[data-testid="optimization-campaign-negatives-form-c-1"]')!.dispatchEvent(new Event('submit'));
      remounted.detectChanges();
      expect(addNegativeKeywords).toHaveBeenLastCalledWith('tlf', 'b-1', 'c-1', [{ text: 'torrent', matchType: 'Broad' }], 'sha256:r2');
    });

    it('treats a Reddit read with no revision as unusable', () => {
      getKeywordTargeting.mockReturnValue(of(targeting()));
      setPlatform('reddit-ads');

      expect(q('optimization-campaign-negatives-revision-error-c-1')).not.toBeNull();
      expect(submitButton().disabled).toBe(true);
    });

    // A mixed batch: ALREADY_PRESENT keeps its own result beside the new keywords' shared outcome.
    it('keeps the ALREADY_PRESENT results of a mixed Reddit batch', () => {
      getKeywordTargeting.mockReturnValue(of(targeting('sha256:r1')));
      addNegativeKeywords.mockReturnValue(
        of({
          campaignId: 'c-1',
          appliedCount: 1,
          results: [
            { text: 'free', matchType: 'Broad', outcome: 'FAILED', errorCode: 'REJECTED' },
            { text: 'torrent', matchType: 'Broad', outcome: 'ALREADY_PRESENT' },
          ],
        })
      );
      setPlatform('reddit-ads');
      typeKeywords('free\ntorrent');
      submit();

      const items = Array.from(el().querySelectorAll('[data-testid^="optimization-campaign-negatives-result-"]'));
      expect(items.map((item) => item.querySelector('[data-outcome]')!.getAttribute('data-outcome'))).toEqual(['FAILED', 'ALREADY_PRESENT']);
      expect(items[0].textContent).toContain('Reddit refused it.');
    });

    it(`offers X its three match types, caps it at ${MAX_X_NEGATIVE_KEYWORDS_PER_REQUEST}, and never reads or sends a revision`, () => {
      addNegativeKeywords.mockReturnValue(of({ campaignId: 'c-1', appliedCount: 0, results: [] }));
      setPlatform('twitter-ads');

      for (const type of ['Exact', 'Phrase', 'Broad']) {
        expect(el().querySelector(`label[for="campaign-negatives-type-c-1-${type}"]`)).not.toBeNull();
      }
      expect(getKeywordTargeting).not.toHaveBeenCalled();

      typeKeywords(Array.from({ length: MAX_X_NEGATIVE_KEYWORDS_PER_REQUEST + 1 }, (_, i) => `kw ${i}`).join('\n'));
      submit();
      expect(addNegativeKeywords).not.toHaveBeenCalled();
      expect(q('optimization-campaign-negatives-error-c-1')!.textContent).toContain(`at most ${MAX_X_NEGATIVE_KEYWORDS_PER_REQUEST}`);

      typeKeywords('free');
      submit();
      expect(addNegativeKeywords).toHaveBeenCalledWith('tlf', 'b-1', 'c-1', [{ text: 'free', matchType: 'Exact' }], undefined);
    });
  });
});
