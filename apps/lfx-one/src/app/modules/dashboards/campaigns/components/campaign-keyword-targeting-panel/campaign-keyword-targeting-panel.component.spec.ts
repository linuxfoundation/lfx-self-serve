// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  KEYWORD_TARGETING_READ_ERROR_MESSAGES,
  KEYWORD_TARGETING_REMOVAL_ERROR_MESSAGES,
  KEYWORD_TARGETING_REMOVAL_OUTCOME_UNCONFIRMED,
  KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_ADVICE,
  KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE,
  KEYWORD_TARGETING_REMOVE_ALL_REASON,
} from '@lfx-one/shared/constants';
import type { CampaignServiceKeywordTargeting, CampaignServiceKeywordTargetingRemovals } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CampaignKeywordTargetingPanelComponent } from './campaign-keyword-targeting-panel.component';

describe('CampaignKeywordTargetingPanelComponent', () => {
  let fixture: ComponentFixture<CampaignKeywordTargetingPanelComponent>;
  let getKeywordTargeting: ReturnType<typeof vi.fn>;
  let removeKeywordTargeting: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;
  /** Confirmations raised, read off the REAL service (the template renders `p-confirmDialog`, which subscribes to it). */
  let confirmations: Confirmation[];
  /** Confirmations raised on the PAGE-WIDE service, which the panel must never use. */
  let pageConfirmations: number;

  const reddit = (over: Partial<CampaignServiceKeywordTargeting> = {}): CampaignServiceKeywordTargeting => ({
    campaign_id: 'c-1',
    platform: 'reddit-ads',
    targeting_entity_id: 'ag-1',
    keywords: [{ keyword: 'kubernetes' }, { keyword: 'Cloud Native' }, { keyword: 'devops' }],
    revision: 'sha256:r1',
    ...over,
  });

  const x = (over: Partial<CampaignServiceKeywordTargeting> = {}): CampaignServiceKeywordTargeting => ({
    campaign_id: 'c-1',
    platform: 'twitter-ads',
    targeting_entity_id: 'li-1',
    keywords: [
      { keyword: 'kubernetes', criterion_id: 'k1', match_type: 'PHRASE_KEYWORD' },
      { keyword: 'devops', criterion_id: 'k2', match_type: 'BROAD_KEYWORD' },
      { keyword: 'orphan' },
    ],
    ...over,
  });

  async function create(
    platform: 'reddit-ads' | 'twitter-ads',
    read: CampaignServiceKeywordTargeting | Subject<CampaignServiceKeywordTargeting>
  ): Promise<void> {
    getKeywordTargeting = vi.fn().mockReturnValue(read instanceof Subject ? read : of(read));
    removeKeywordTargeting = vi.fn();
    messageAdd = vi.fn();
    await TestBed.configureTestingModule({
      imports: [CampaignKeywordTargetingPanelComponent],
      providers: [
        provideNoopAnimations(),
        // A page-wide instance, which the panel must NOT use: its dialog has its own.
        ConfirmationService,
        { provide: CampaignService, useValue: { getKeywordTargeting, removeKeywordTargeting } },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    }).compileComponents();
    confirmations = [];
    pageConfirmations = 0;
    TestBed.inject(ConfirmationService).requireConfirmation$.subscribe(() => pageConfirmations++);
    mount(platform);
  }

  /** (Re)creates the panel, as the row's toggle does, and records its OWN dialog's confirmations. */
  function mount(platform: 'reddit-ads' | 'twitter-ads'): void {
    fixture = TestBed.createComponent(CampaignKeywordTargetingPanelComponent);
    fixture.debugElement.injector.get(ConfirmationService).requireConfirmation$.subscribe((c) => {
      if (c) {
        confirmations.push(c);
      }
    });
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('briefId', 'b-1');
    fixture.componentRef.setInput('campaignId', 'c-1');
    fixture.componentRef.setInput('campaignName', 'KubeCon EU');
    fixture.componentRef.setInput('platform', platform);
    fixture.detectChanges();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = (testId: string): HTMLElement | null => el().querySelector(`[data-testid="${testId}"]`);
  const removeButton = (): HTMLButtonElement => q('optimization-campaign-targeting-remove-c-1')!.querySelector('button') as HTMLButtonElement;

  function tick(key: string): void {
    (q(`optimization-campaign-targeting-select-${key}`) as HTMLInputElement).click();
    fixture.detectChanges();
  }

  function clickRemove(): void {
    removeButton().click();
    fixture.detectChanges();
  }

  function accept(): void {
    confirmations[confirmations.length - 1].accept!();
    fixture.detectChanges();
  }

  describe('reading', () => {
    it('lists the targeted keywords, read for this campaign', async () => {
      await create('reddit-ads', reddit());

      expect(getKeywordTargeting).toHaveBeenCalledWith('tlf', 'b-1', 'c-1');
      expect(q('optimization-campaign-targeting-item-kubernetes')!.textContent).toContain('kubernetes');
      expect(q('optimization-campaign-targeting-item-Cloud Native')).not.toBeNull();
      expect(removeButton().disabled).toBe(true);
    });

    it("shows X's match types and offers no handle for an entry X gave no criterion id", async () => {
      await create('twitter-ads', x());

      expect(q('optimization-campaign-targeting-item-k1')!.textContent).toContain('Phrase');
      const orphan = el().querySelector('[data-testid^="optimization-campaign-targeting-item-unaddressable-"]')!;
      expect(orphan.textContent).toContain("Can't be removed here");
      expect((orphan.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    });

    it('says so when nothing is targeted, explaining X', async () => {
      await create('twitter-ads', x({ keywords: [] }));

      expect(q('optimization-campaign-targeting-empty-c-1')!.textContent).toContain('X Ads Manager');
    });

    it('shows a read failure in fixed words, never upstream text, and retries on request', async () => {
      const read = new Subject<CampaignServiceKeywordTargeting>();
      await create('reddit-ads', read);
      expect(q('optimization-campaign-targeting-loading-c-1')).not.toBeNull();

      read.error(new HttpErrorResponse({ status: 409, error: { error: 'ad group 77 reports campaign 12', code: 'CONFLICT' } }));
      fixture.detectChanges();
      const error = q('optimization-campaign-targeting-error-c-1')!;
      expect(error.textContent).toContain(KEYWORD_TARGETING_READ_ERROR_MESSAGES.conflict);
      expect(error.textContent).not.toContain('ad group 77');

      getKeywordTargeting.mockReturnValue(of(reddit()));
      (q('optimization-campaign-targeting-retry-c-1')!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(q('optimization-campaign-targeting-item-kubernetes')).not.toBeNull();
    });
  });

  describe('removing', () => {
    it('asks before removing, and sends nothing when the operator cancels', async () => {
      await create('reddit-ads', reddit());
      tick('kubernetes');
      clickRemove();

      expect(confirmations).toHaveLength(1);
      // The panel's own ConfirmationService: no other dialog on the page can answer it.
      expect(pageConfirmations).toBe(0);
      expect(confirmations[0].message).toContain('"kubernetes"');
      expect(confirmations[0].message).toContain('Reddit');
      expect(removeKeywordTargeting).not.toHaveBeenCalled();
    });

    it("sends Reddit keywords by text with the read's revision, once", async () => {
      await create('reddit-ads', reddit());
      removeKeywordTargeting.mockReturnValue(of({ campaign_id: 'c-1', results: [], applied_count: 0 }));
      tick('Cloud Native');
      tick('kubernetes');
      clickRemove();
      accept();

      expect(removeKeywordTargeting).toHaveBeenCalledTimes(1);
      // List order, not click order.
      expect(removeKeywordTargeting).toHaveBeenCalledWith('tlf', 'c-1', {
        briefId: 'b-1',
        keywords: [{ keyword: 'kubernetes' }, { keyword: 'Cloud Native' }],
        revision: 'sha256:r1',
      });
    });

    // X refuses a revision whenever it is present, even empty: it must never be sent there.
    it('sends X keywords by criterion id and never a revision, even if the read carried one', async () => {
      await create('twitter-ads', x({ revision: 'sha256:stray' }));
      removeKeywordTargeting.mockReturnValue(of({ campaign_id: 'c-1', results: [], applied_count: 0 }));
      tick('k2');
      clickRemove();
      accept();

      const request = removeKeywordTargeting.mock.calls[0][2];
      expect(request).toEqual({ briefId: 'b-1', keywords: [{ criterionId: 'k2' }] });
      expect(request).not.toHaveProperty('revision');
    });

    it('holds back a removal of every keyword, saying why', async () => {
      await create('reddit-ads', reddit());
      tick('kubernetes');
      tick('Cloud Native');
      tick('devops');

      expect(q('optimization-campaign-targeting-blocked-c-1')!.textContent).toContain(KEYWORD_TARGETING_REMOVE_ALL_REASON);
      expect(removeButton().disabled).toBe(true);
      clickRemove();
      expect(confirmations).toHaveLength(0);
    });

    it('refuses to remove on Reddit when the read gave no revision', async () => {
      await create('reddit-ads', reddit({ revision: undefined }));
      tick('kubernetes');

      expect(removeButton().disabled).toBe(true);
      expect(q('optimization-campaign-targeting-blocked-c-1')!.textContent).toContain('Reload');
    });

    // POSITIONAL: results[i] answers the i-th keyword sent. UNCONFIRMED is "may or may not", never a failure.
    it('shows each outcome against the keyword sent at its position, then re-reads the targeting', async () => {
      await create('twitter-ads', x({ keywords: [...x().keywords.slice(0, 2), { keyword: 'cncf', criterion_id: 'k3', match_type: 'EXACT_KEYWORD' }] }));
      const response: CampaignServiceKeywordTargetingRemovals = {
        campaign_id: 'c-1',
        applied_count: 1,
        results: [
          { criterion_id: 'k1', outcome: 'UNCONFIRMED' },
          { criterion_id: 'k2', outcome: 'FAILED', error_code: 'WOULD_EMPTY' },
        ],
      };
      removeKeywordTargeting.mockReturnValue(of(response));
      tick('k1');
      tick('k2');
      clickRemove();
      accept();

      const items = Array.from(el().querySelectorAll('[data-testid^="optimization-campaign-targeting-result-"]'));
      expect(items.map((item) => item.querySelector('[data-outcome]')!.getAttribute('data-outcome'))).toEqual(['UNCONFIRMED', 'FAILED']);
      expect(items[0].textContent).toContain('kubernetes');
      expect(items[0].textContent).toContain('Not confirmed');
      expect(items[0].textContent).toContain(KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_ADVICE);
      expect(items[0].textContent).not.toContain('Not removed');
      expect(items[1].textContent).toContain('last keyword');
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', sticky: true }));
      // Re-read after the removal settled.
      expect(getKeywordTargeting).toHaveBeenCalledTimes(2);
    });

    it("treats the BFF's unconfirmed code as may-or-may-not, names the keywords, and re-reads", async () => {
      await create('reddit-ads', reddit());
      removeKeywordTargeting.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 503,
              error: { error: KEYWORD_TARGETING_REMOVAL_OUTCOME_UNCONFIRMED, code: KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE },
            })
        )
      );
      tick('kubernetes');
      clickRemove();
      accept();

      const unconfirmed = q('optimization-campaign-targeting-unconfirmed-c-1')!;
      expect(unconfirmed.textContent).toContain('may or may not have been removed');
      expect(unconfirmed.textContent).toContain('kubernetes');
      expect(q('optimization-campaign-targeting-failed-c-1')).toBeNull();
      expect(getKeywordTargeting).toHaveBeenCalledTimes(2);
      expect(removeKeywordTargeting).toHaveBeenCalledTimes(1);
    });

    it('treats an answer from something in front of the BFF as unconfirmed', async () => {
      await create('reddit-ads', reddit());
      removeKeywordTargeting.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 504, error: 'upstream request timeout' })));
      tick('kubernetes');
      clickRemove();
      accept();

      expect(q('optimization-campaign-targeting-unconfirmed-c-1')).not.toBeNull();
    });

    it('shows a definite refusal in fixed words, never the upstream message', async () => {
      await create('reddit-ads', reddit());
      removeKeywordTargeting.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'targeting fingerprint sha256:zz differs', code: 'CONFLICT' } }))
      );
      tick('kubernetes');
      clickRemove();
      accept();

      const failed = q('optimization-campaign-targeting-failed-c-1')!;
      expect(failed.textContent!.trim()).toBe(KEYWORD_TARGETING_REMOVAL_ERROR_MESSAGES.conflict);
      expect(failed.textContent).not.toContain('fingerprint');
    });

    it('words a 400 on Reddit as writes possibly switched off', async () => {
      await create('reddit-ads', reddit());
      removeKeywordTargeting.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'Reddit keyword targeting writes are disabled', code: 'BAD_REQUEST' } }))
      );
      tick('kubernetes');
      clickRemove();
      accept();

      expect(q('optimization-campaign-targeting-failed-c-1')!.textContent!.trim()).toBe(KEYWORD_TARGETING_REMOVAL_ERROR_MESSAGES.refusedReddit);
    });

    it('holds Remove, Reload and Close while a removal is in flight', async () => {
      await create('reddit-ads', reddit());
      const pending = new Subject<CampaignServiceKeywordTargetingRemovals>();
      removeKeywordTargeting.mockReturnValue(pending);
      tick('kubernetes');
      clickRemove();
      accept();

      expect(removeButton().disabled).toBe(true);
      expect((q('optimization-campaign-targeting-close-c-1')!.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
      expect((q('optimization-campaign-targeting-reload-c-1')!.querySelector('button') as HTMLButtonElement).disabled).toBe(true);

      pending.next({ campaign_id: 'c-1', applied_count: 1, results: [{ keyword: 'kubernetes', outcome: 'APPLIED' }] });
      pending.complete();
      fixture.detectChanges();
      expect(q('optimization-campaign-targeting-result-0')!.textContent).toContain('Removed');
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: '1 removed.' }));
    });
  });

  // The row's toggle can close the panel; a tab switch or list re-read unmounts it. The removal
  // runs on in the root service, so a reopened panel shows it running, cannot start another, and
  // then shows its outcome with a fresh read.
  describe('across a remount', () => {
    it('keeps the in-flight removal and its outcome, and refuses a second removal meanwhile', async () => {
      await create('reddit-ads', reddit());
      const pending = new Subject<CampaignServiceKeywordTargetingRemovals>();
      removeKeywordTargeting.mockReturnValue(pending);
      tick('kubernetes');
      clickRemove();
      accept();
      fixture.destroy();

      mount('reddit-ads');
      expect(removeButton().disabled).toBe(true);
      expect(el().querySelector('[data-testid="optimization-campaign-targeting-select-devops"]')!.closest('fieldset')!.disabled).toBe(true);
      expect((q('optimization-campaign-targeting-close-c-1')!.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
      const readsBefore = getKeywordTargeting.mock.calls.length;

      pending.next({ campaign_id: 'c-1', applied_count: 0, results: [{ keyword: 'kubernetes', outcome: 'UNCONFIRMED' }] });
      pending.complete();
      fixture.detectChanges();

      expect(removeKeywordTargeting).toHaveBeenCalledTimes(1);
      expect(q('optimization-campaign-targeting-result-0')!.querySelector('[data-outcome]')!.getAttribute('data-outcome')).toBe('UNCONFIRMED');
      // The reopened panel re-reads once the removal settles.
      expect(getKeywordTargeting.mock.calls.length).toBe(readsBefore + 1);
    });

    it('shows a removal that settled while the panel was closed', async () => {
      await create('reddit-ads', reddit());
      removeKeywordTargeting.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 504, error: 'upstream request timeout' })));
      tick('kubernetes');
      clickRemove();
      accept();
      fixture.destroy();

      mount('reddit-ads');
      expect(q('optimization-campaign-targeting-unconfirmed-c-1')!.textContent).toContain('kubernetes');
    });
  });
});
