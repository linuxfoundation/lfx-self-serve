// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  CAMPAIGN_ACT_AMBIGUOUS_MESSAGE,
  CAMPAIGN_ADOPT_BRIEFS_EMPTY_MESSAGE,
  CAMPAIGN_ADOPT_BRIEFS_UNAVAILABLE_MESSAGE,
  CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED,
  CAMPAIGN_ADOPT_VERIFY_ABSENT_MESSAGE,
  CAMPAIGN_ADOPT_VERIFY_OTHER_BRIEF_MESSAGE,
  CAMPAIGN_ADOPT_VERIFY_UNEXPECTED_MESSAGE,
} from '@lfx-one/shared/constants';
import type { CampaignAdoptDialogData } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CampaignAdoptDialogComponent } from './campaign-adopt-dialog.component';

const BRIEFS = { briefs: [{ id: 'b-1', eventSlug: 'kubecon-eu', programType: 'events', platforms: ['linkedin-ads'] }] };

/** A refusal in the BFF's own `{ error, code }` envelope, as campaign-service's answer is relayed. */
function bffError(status: number, error: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { error, code: 'CLIENT_ERROR' } });
}

describe('CampaignAdoptDialogComponent (#3299)', () => {
  let fixture: ComponentFixture<CampaignAdoptDialogComponent>;
  let close: ReturnType<typeof vi.fn>;
  /** Each dialog instance's OWN ref, in creation order; every one also reports to `close`. */
  let refs: ReturnType<typeof vi.fn>[];
  let toast: ReturnType<typeof vi.fn>;
  let service: { listAdoptableBriefs: ReturnType<typeof vi.fn>; adoptCampaign: ReturnType<typeof vi.fn>; resolvePlatformCampaign: ReturnType<typeof vi.fn> };

  async function setup(briefs: unknown = of(BRIEFS)): Promise<void> {
    TestBed.resetTestingModule();
    close = vi.fn();
    refs = [];
    toast = vi.fn();
    service = { listAdoptableBriefs: vi.fn(() => briefs), adoptCampaign: vi.fn(), resolvePlatformCampaign: vi.fn() };
    const data: CampaignAdoptDialogData = { projectSlug: 'tlf', platform: 'linkedin-ads', platformCampaignId: '123456', campaignName: 'KubeCon EU' };
    await TestBed.configureTestingModule({
      imports: [CampaignAdoptDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: CampaignService, useValue: service },
        { provide: MessageService, useValue: { add: toast } },
      ],
    })
      // A ref per dialog instance, as DialogService gives each opening its own: a close aimed at the
      // first dialog's ref must not pass for the reopened dialog closing.
      .overrideComponent(CampaignAdoptDialogComponent, {
        add: {
          providers: [
            {
              provide: DynamicDialogRef,
              useFactory: () => {
                const own = vi.fn((result?: unknown) => close(result));
                refs.push(own);
                return { close: own };
              },
            },
          ],
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(CampaignAdoptDialogComponent);
    fixture.detectChanges();
  }

  const q = (testId: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => q(testId)?.textContent ?? '';

  function chooseAndSubmit(): void {
    fixture.componentInstance.form.controls.briefId.setValue('b-1');
    q('campaign-adopt-dialog')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('adopts into the chosen approved brief and closes with true', async () => {
    await setup();
    service.adoptCampaign.mockReturnValue(of({ id: 'c-9' }));

    chooseAndSubmit();

    expect(service.listAdoptableBriefs).toHaveBeenCalledWith('tlf');
    expect(service.adoptCampaign).toHaveBeenCalledWith('tlf', { briefId: 'b-1', platform: 'linkedin-ads', platformCampaignId: '123456' });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Adopted KubeCon EU' }));
    expect(close).toHaveBeenCalledWith(true);
  });

  it('sends nothing without a chosen brief', async () => {
    await setup();

    q('campaign-adopt-dialog')!.dispatchEvent(new Event('submit'));

    expect(service.adoptCampaign).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'Not adopted: the request was refused', 'exactly as LinkedIn Ads shows it', 'platform_campaign_id is malformed'],
    [404, 'Not adopted: no such campaign', 'LinkedIn Ads reports no campaign with this id', ''],
    [409, 'Not adopted: this campaign cannot be bound to this brief', 'already belong to another brief', 'already bound to a different brief'],
    [503, 'Not adopted: the campaign could not be verified', 'does not mean the campaign is missing', ''],
  ])('maps a %s to an actionable message', async (status, title, message, upstream) => {
    await setup();
    service.adoptCampaign.mockReturnValue(throwError(() => bffError(status, upstream || 'refused')));

    chooseAndSubmit();

    expect(text('campaign-adopt-dialog-error-title')).toBe(title);
    expect(text('campaign-adopt-dialog-error-message')).toContain(message);
    if (upstream) {
      expect(text('campaign-adopt-dialog-error-detail')).toContain(upstream);
    } else {
      expect(q('campaign-adopt-dialog-error-detail')).toBeNull();
    }
    expect(close).not.toHaveBeenCalled();
  });

  it('never retries an unconfirmed adoption: Adopt waits for a check, which can confirm it', async () => {
    await setup();
    service.adoptCampaign.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 504, error: { error: CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED, code: 'GATEWAY' } }))
    );

    chooseAndSubmit();

    expect(text('campaign-adopt-dialog-unconfirmed')).toContain(CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED);
    expect((q('campaign-adopt-dialog-submit')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    chooseAndSubmit();
    expect(service.adoptCampaign).toHaveBeenCalledTimes(1);

    service.resolvePlatformCampaign.mockReturnValue(of({ platform_campaign_id: '123456', matches: [{ campaign_id: 'c-9', brief_id: 'b-1' }], match_count: 1 }));
    (q('campaign-adopt-dialog-verify')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(service.resolvePlatformCampaign).toHaveBeenCalledWith('tlf', 'linkedin-ads', '123456');
    expect(close).toHaveBeenCalledWith(true);
  });

  it('re-offers Adopt when the check finds the adoption did not happen', async () => {
    await setup();
    service.adoptCampaign.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    chooseAndSubmit();
    service.resolvePlatformCampaign.mockReturnValue(of({ platform_campaign_id: '123456', matches: [], match_count: 0 }));

    (q('campaign-adopt-dialog-verify')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(text('campaign-adopt-dialog-error-message')).toContain(CAMPAIGN_ADOPT_VERIFY_ABSENT_MESSAGE);
    expect((q('campaign-adopt-dialog-submit')?.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    ['a count that disagrees with the list', { platform_campaign_id: '123456', matches: [{ campaign_id: 'c-9', brief_id: 'b-1' }], match_count: 0 }],
    ['an empty list counted as one', { platform_campaign_id: '123456', matches: [], match_count: 1 }],
    ['another id echoed back', { platform_campaign_id: '999999', matches: [{ campaign_id: 'c-9', brief_id: 'b-1' }], match_count: 1 }],
  ])('keeps the adoption unconfirmed on %s: no success, Adopt stays locked', async (_label, answer) => {
    await setup();
    service.adoptCampaign.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    chooseAndSubmit();
    service.resolvePlatformCampaign.mockReturnValue(of(answer));

    (q('campaign-adopt-dialog-verify')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(close).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(text('campaign-adopt-dialog-unconfirmed-detail')).toContain(CAMPAIGN_ADOPT_VERIFY_UNEXPECTED_MESSAGE);
    expect((q('campaign-adopt-dialog-submit')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  /** A second dialog for the same campaign, in the same app (so the same root store). */
  function reopen(): void {
    fixture.destroy();
    fixture = TestBed.createComponent(CampaignAdoptDialogComponent);
    fixture.detectChanges();
  }

  const submitDisabled = (): boolean => (q('campaign-adopt-dialog-submit')?.querySelector('button') as HTMLButtonElement).disabled;

  it('keeps an unconfirmed adoption locked in a reopened dialog until a check settles it', async () => {
    await setup();
    service.adoptCampaign.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    chooseAndSubmit();

    reopen();

    expect(text('campaign-adopt-dialog-unconfirmed')).toContain(CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED);
    expect(submitDisabled()).toBe(true);
    chooseAndSubmit();
    expect(service.adoptCampaign).toHaveBeenCalledTimes(1);

    service.resolvePlatformCampaign.mockReturnValue(of({ platform_campaign_id: '123456', matches: [{ campaign_id: 'c-9', brief_id: 'b-1' }], match_count: 1 }));
    (q('campaign-adopt-dialog-verify')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('keeps a write in flight locked in a reopened dialog, and reports its late outcome in a sticky toast', async () => {
    await setup();
    const reply = new Subject<never>();
    service.adoptCampaign.mockReturnValue(reply);
    chooseAndSubmit();

    reopen();
    expect(q('campaign-adopt-dialog-pending')).not.toBeNull();
    expect(submitDisabled()).toBe(true);

    reply.error(new HttpErrorResponse({ status: 0 }));
    fixture.detectChanges();

    // The first dialog is gone, so its outcome is a sticky warning; the open one shows it as unconfirmed.
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', sticky: true }));
    expect(q('campaign-adopt-dialog-unconfirmed')).not.toBeNull();
    expect(submitDisabled()).toBe(true);
  });

  it('closes a dialog reopened while the write was in flight once that write succeeds, never re-offering Adopt', async () => {
    await setup();
    const reply = new Subject<{ id: string }>();
    service.adoptCampaign.mockReturnValue(reply);
    chooseAndSubmit();

    reopen();
    expect(submitDisabled()).toBe(true);

    reply.next({ id: 'c-9' });
    reply.complete();
    fixture.detectChanges();

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Adopted KubeCon EU' }));
    // The REOPENED dialog (the second ref) is the one that closes.
    expect(refs[1]).toHaveBeenCalledWith(true);
    expect(service.adoptCampaign).toHaveBeenCalledTimes(1);
  });

  it('closes at once a dialog opened after a success that no dialog showed', async () => {
    await setup();
    const reply = new Subject<{ id: string }>();
    service.adoptCampaign.mockReturnValue(reply);
    chooseAndSubmit();
    fixture.destroy();
    reply.next({ id: 'c-9' });
    close.mockClear();

    fixture = TestBed.createComponent(CampaignAdoptDialogComponent);
    fixture.detectChanges();

    expect(close).toHaveBeenCalledWith(true);
    expect(service.adoptCampaign).toHaveBeenCalledTimes(1);
  });

  it('reports a definite refusal that lands after the dialog closed in a sticky error toast', async () => {
    await setup();
    const reply = new Subject<never>();
    service.adoptCampaign.mockReturnValue(reply);
    chooseAndSubmit();
    fixture.destroy();

    reply.error(bffError(409, 'already bound to a different brief'));

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', sticky: true, summary: 'Not adopted: this campaign cannot be bound to this brief: KubeCon EU' })
    );
  });

  it('keeps the adoption unconfirmed and locked when the check finds several matches', async () => {
    await setup();
    service.adoptCampaign.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    chooseAndSubmit();
    service.resolvePlatformCampaign.mockReturnValue(
      of({
        platform_campaign_id: '123456',
        matches: [
          { campaign_id: 'c-9', brief_id: 'b-1' },
          { campaign_id: 'c-8', brief_id: 'b-2' },
        ],
        match_count: 2,
      })
    );

    (q('campaign-adopt-dialog-verify')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(q('campaign-adopt-dialog-unconfirmed')).not.toBeNull();
    expect(text('campaign-adopt-dialog-unconfirmed-detail')).toContain(CAMPAIGN_ACT_AMBIGUOUS_MESSAGE);
    expect(submitDisabled()).toBe(true);
    expect(close).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();

    reopen();
    expect(submitDisabled()).toBe(true);
  });

  it('never reports success when the check finds the campaign bound to a different brief', async () => {
    await setup();
    service.adoptCampaign.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    chooseAndSubmit();
    service.resolvePlatformCampaign.mockReturnValue(
      of({ platform_campaign_id: '123456', matches: [{ campaign_id: 'c-9', brief_id: 'b-other' }], match_count: 1 })
    );

    (q('campaign-adopt-dialog-verify')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(close).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(text('campaign-adopt-dialog-error-title')).toBe('Not adopted: bound to a different brief');
    expect(text('campaign-adopt-dialog-error-message')).toContain(CAMPAIGN_ADOPT_VERIFY_OTHER_BRIEF_MESSAGE);
  });

  it('says adoption is unavailable when the brief list route answers 404', async () => {
    await setup(throwError(() => new HttpErrorResponse({ status: 404 })));

    expect(text('campaign-adopt-dialog-briefs-error')).toContain(CAMPAIGN_ADOPT_BRIEFS_UNAVAILABLE_MESSAGE);
  });

  it('says what to do when there is no approved brief', async () => {
    await setup(of({ briefs: [] }));

    expect(text('campaign-adopt-dialog-briefs-empty')).toContain(CAMPAIGN_ADOPT_BRIEFS_EMPTY_MESSAGE);
    expect((q('campaign-adopt-dialog-submit')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
