// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import {
  CAMPAIGN_ACT_AMBIGUOUS_MESSAGE,
  CAMPAIGN_ACT_META_RESUME_NOTE,
  CAMPAIGN_ACT_RESOLVE_UNAVAILABLE_MESSAGE,
  CAMPAIGN_ACT_RESOLVE_UNEXPECTED_MESSAGE,
  CAMPAIGN_ACT_RESUME_ADOPTED_NOTE,
  CAMPAIGN_ACT_UNOWNED_MESSAGE,
  CAMPAIGN_BID_UNAVAILABLE_X_ADOPTED_REASON,
  CAMPAIGN_BUDGET_BLOCKED_PACING_CHECK_REASON,
  CAMPAIGN_BUDGET_X_LIFETIME_REASON,
  CAMPAIGN_ETAG_STALE_MESSAGE,
  CAMPAIGN_RESUME_REFUSED_CODE,
  CAMPAIGN_UNAVAILABLE_DEPLOYMENT_REASON,
  CAMPAIGN_UNAVAILABLE_RESUME_PLATFORM_REASON,
  campaignResumeAdoptedReason,
  campaignResumeRefusedMessage,
} from '@lfx-one/shared/constants';
import type {
  CampaignActDialogData,
  CampaignRecordResult,
  CampaignServiceCampaign,
  CampaignServiceCampaignResolution,
  CampaignServiceSettingsReadback,
  CampaignStatusToggleParams,
} from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CampaignBidFormComponent } from '../campaign-bid-form/campaign-bid-form.component';
import { CampaignBudgetFormComponent } from '../campaign-budget-form/campaign-budget-form.component';
import { CampaignActDialogComponent } from './campaign-act-dialog.component';

const CAMPAIGN: CampaignServiceCampaign = {
  id: 'c-1',
  brief_id: 'b-1',
  project_id: 'p-1',
  platform: 'linkedin-ads',
  campaign_name: 'KubeCon EU',
  platform_campaign_id: '123456',
  status: 'active',
  version: 3,
  etag: '"3"',
};

function resolution(count: number): CampaignServiceCampaignResolution {
  const matches = Array.from({ length: count }, (_, i) => ({ campaign_id: `c-${i + 1}`, brief_id: `b-${i + 1}` }));
  return { platform_campaign_id: '123456', matches, match_count: count };
}

/** A live settings readback reporting `pacing` as the campaign's budget type (absent: unreported). */
function settingsWith(pacing?: string): CampaignServiceSettingsReadback {
  return {
    campaign_id: 'c-1',
    platform_campaign_id: '123456',
    platform: 'twitter-ads',
    read_at: '2026-10-15T10:00:00Z',
    fields: [{ field: 'budget_type', ...(pacing === undefined ? {} : { upstream: pacing }), comparison: 'unknown' }],
    diverged_count: 0,
    unknown_count: 1,
  };
}

/** A refusal in the BFF's own `{ error, code }` envelope. */
function bffError(status: number, error: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { error, code: 'CLIENT_ERROR' } });
}

describe('CampaignActDialogComponent (#3299)', () => {
  let fixture: ComponentFixture<CampaignActDialogComponent>;
  let close: ReturnType<typeof vi.fn>;
  let toast: ReturnType<typeof vi.fn>;
  let service: {
    resolvePlatformCampaign: ReturnType<typeof vi.fn>;
    getCampaignRecord: ReturnType<typeof vi.fn>;
    updateCampaignStatus: ReturnType<typeof vi.fn>;
    updateCampaignBudget: ReturnType<typeof vi.fn>;
    updateCampaignBid: ReturnType<typeof vi.fn>;
    getCampaignSettings: ReturnType<typeof vi.fn>;
  };

  async function setup(data: Partial<CampaignActDialogData> = {}, record: Partial<CampaignRecordResult> = {}, resolved = resolution(1)): Promise<void> {
    TestBed.resetTestingModule();
    close = vi.fn();
    toast = vi.fn();
    service = {
      resolvePlatformCampaign: vi.fn(() => of(resolved)),
      getCampaignRecord: vi.fn(() => of({ campaign: CAMPAIGN, statusToggleEnabled: true, ...record })),
      updateCampaignStatus: vi.fn(),
      updateCampaignBudget: vi.fn(),
      updateCampaignBid: vi.fn(),
      getCampaignSettings: vi.fn(() => of(settingsWith('daily'))),
    };
    const dialogData: CampaignActDialogData = {
      projectSlug: 'tlf',
      platform: 'linkedin-ads',
      platformCampaignId: '123456',
      campaignName: 'KubeCon EU',
      lever: 'pause_resume',
      ...data,
    };
    await TestBed.configureTestingModule({
      imports: [CampaignActDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: dialogData } },
        { provide: CampaignService, useValue: service },
        { provide: MessageService, useValue: { add: toast } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CampaignActDialogComponent);
    fixture.detectChanges();
  }

  const q = (testId: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);
  const click = (testId: string): void => {
    (q(testId)?.querySelector('button') ?? q(testId))?.click();
    fixture.detectChanges();
  };

  it('resolves the platform id first, then reads the one matched campaign and offers its lever', async () => {
    await setup();

    expect(service.resolvePlatformCampaign).toHaveBeenCalledWith('tlf', 'linkedin-ads', '123456');
    expect(service.getCampaignRecord).toHaveBeenCalledWith('tlf', 'b-1', 'c-1');
    expect(q('campaign-act-dialog-ready')).not.toBeNull();
    expect(q('campaign-act-dialog-toggle')?.textContent).toContain('Pause');
  });

  it('offers adoption when LFX One does not manage the campaign, and changes nothing', async () => {
    await setup({}, {}, resolution(0));

    expect(q('campaign-act-dialog-unowned')?.textContent).toContain(CAMPAIGN_ACT_UNOWNED_MESSAGE);
    expect(service.getCampaignRecord).not.toHaveBeenCalled();
    click('campaign-act-dialog-adopt');
    expect(close).toHaveBeenCalledWith({ adopt: true });
  });

  it('refuses several matches rather than choosing one', async () => {
    await setup({ platform: 'reddit-ads' }, {}, resolution(2));

    expect(q('campaign-act-dialog-ambiguous')?.textContent).toContain(CAMPAIGN_ACT_AMBIGUOUS_MESSAGE);
    expect(q('campaign-act-dialog-ambiguous')?.textContent).toContain('2 campaigns');
    expect(service.getCampaignRecord).not.toHaveBeenCalled();
    expect(q('campaign-act-dialog-toggle')).toBeNull();
  });

  // A self-contradicting answer names no campaign: nothing is read, offered or adopted on its strength.
  it.each([
    ['a count above the list', { platform_campaign_id: '123456', matches: [{ campaign_id: 'c-1', brief_id: 'b-1' }], match_count: 2 }],
    ['a count below the list', { platform_campaign_id: '123456', matches: [{ campaign_id: 'c-1', brief_id: 'b-1' }], match_count: 0 }],
    ['another id echoed back', { platform_campaign_id: '999999', matches: [{ campaign_id: 'c-1', brief_id: 'b-1' }], match_count: 1 }],
  ])('refuses %s as an answer it cannot trust', async (_label, answer) => {
    await setup({}, {}, answer);

    expect(q('campaign-act-dialog-resolve-failed')?.textContent).toContain(CAMPAIGN_ACT_RESOLVE_UNEXPECTED_MESSAGE);
    expect(service.getCampaignRecord).not.toHaveBeenCalled();
    expect(q('campaign-act-dialog-adopt')).toBeNull();
    expect(q('campaign-act-dialog-ready')).toBeNull();
  });

  it('says the lookup is not served here when the resolve route answers 404, and retries on demand', async () => {
    await setup();
    service.resolvePlatformCampaign.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    fixture.componentInstance['resolve']();
    fixture.detectChanges();

    expect(q('campaign-act-dialog-resolve-failed')?.textContent).toContain(CAMPAIGN_ACT_RESOLVE_UNAVAILABLE_MESSAGE);
    service.resolvePlatformCampaign.mockReturnValue(of(resolution(1)));
    click('campaign-act-dialog-retry');
    expect(q('campaign-act-dialog-ready')).not.toBeNull();
  });

  it('pauses with the record ETag as If-Match and keeps the fresh ETag for the next write', async () => {
    await setup();
    service.updateCampaignStatus.mockReturnValue(of({ platform: 'linkedin-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, etag: '"4"' }));

    click('campaign-act-dialog-toggle');

    const sent = service.updateCampaignStatus.mock.calls[0][0] as CampaignStatusToggleParams;
    expect(sent).toEqual({ projectSlug: 'tlf', briefId: 'b-1', campaignId: 'c-1', platform: 'linkedin-ads', status: 'PAUSED', etag: '"3"' });
    expect(q('campaign-act-dialog-toggle')?.textContent).toContain('Resume');
    expect(q('campaign-act-dialog-resume-note')?.textContent).toContain(CAMPAIGN_ACT_RESUME_ADOPTED_NOTE);

    service.updateCampaignStatus.mockReturnValue(of({ platform: 'linkedin-ads', campaignId: 'c-1', newStatus: 'ACTIVE', success: true, etag: '"5"' }));
    click('campaign-act-dialog-toggle');
    expect((service.updateCampaignStatus.mock.calls[1][0] as CampaignStatusToggleParams).etag).toBe('"4"');
  });

  it("shows the BFF's CAMPAIGN_RESUME_REFUSED message for a refused resume (an adopted campaign) and does not retry it", async () => {
    await setup({}, { campaign: { ...CAMPAIGN, status: 'paused' } });
    const refusal = campaignResumeRefusedMessage('LinkedIn Ads', 'campaign is not fully provisioned');
    service.updateCampaignStatus.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { error: refusal, code: CAMPAIGN_RESUME_REFUSED_CODE } })) as Observable<never>
    );

    click('campaign-act-dialog-toggle');

    expect(q('campaign-act-dialog-toggle-error')?.textContent).toContain('resume it in LinkedIn Ads itself');
    expect(service.updateCampaignStatus).toHaveBeenCalledTimes(1);
  });

  // campaign-service marks an adopted campaign `adopted: true` and never resumes it, so Resume is
  // withheld up front: still focusable (aria-disabled), described, and a click sends nothing.
  it('withholds Resume on a campaign campaign-service marks adopted, and a click sends nothing', async () => {
    await setup({}, { campaign: { ...CAMPAIGN, status: 'paused', adopted: true } });

    const button = q('campaign-act-dialog-toggle') as HTMLButtonElement;
    const reason = q('campaign-act-dialog-resume-adopted');
    expect(button.textContent).toContain('Resume');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    expect(reason?.textContent?.trim()).toBe(campaignResumeAdoptedReason('LinkedIn Ads'));
    expect(button.getAttribute('aria-describedby')).toBe(reason?.id);
    // The hedged note gives way to the precise reason.
    expect(q('campaign-act-dialog-resume-note')).toBeNull();

    click('campaign-act-dialog-toggle');

    expect(service.updateCampaignStatus).not.toHaveBeenCalled();
    expect(q('campaign-act-dialog-toggle-error')).toBeNull();
  });

  it('keeps Pause on a running adopted campaign', async () => {
    await setup({}, { campaign: { ...CAMPAIGN, adopted: true } });
    service.updateCampaignStatus.mockReturnValue(of({ platform: 'linkedin-ads', campaignId: 'c-1', newStatus: 'PAUSED', success: true, etag: '"4"' }));

    expect(q('campaign-act-dialog-toggle')?.textContent).toContain('Pause');
    expect(q('campaign-act-dialog-resume-adopted')).toBeNull();
    click('campaign-act-dialog-toggle');

    expect(service.updateCampaignStatus).toHaveBeenCalledTimes(1);
  });

  it('offers Resume as before when adopted is absent', async () => {
    await setup({}, { campaign: { ...CAMPAIGN, status: 'paused' } });
    service.updateCampaignStatus.mockReturnValue(of({ platform: 'linkedin-ads', campaignId: 'c-1', newStatus: 'ACTIVE', success: true, etag: '"4"' }));

    expect(q('campaign-act-dialog-resume-adopted')).toBeNull();
    expect(q('campaign-act-dialog-resume-note')?.textContent).toContain(CAMPAIGN_ACT_RESUME_ADOPTED_NOTE);
    click('campaign-act-dialog-toggle');

    expect(service.updateCampaignStatus).toHaveBeenCalledTimes(1);
  });

  it('notes on a Meta resume that a deliberately paused ad set must be handled first', async () => {
    await setup({ platform: 'meta-ads' }, { campaign: { ...CAMPAIGN, platform: 'meta-ads', status: 'paused' } });

    const notes = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="campaign-act-dialog-resume-note"]')).map(
      (n) => n.textContent
    );
    expect(notes.join(' ')).toContain(CAMPAIGN_ACT_META_RESUME_NOTE);
  });

  it('blocks every lever after a 412 until the campaign is reloaded', async () => {
    await setup();
    service.updateCampaignStatus.mockReturnValue(throwError(() => bffError(412, 'stale')));

    click('campaign-act-dialog-toggle');

    expect(q('campaign-act-dialog-conflict')).not.toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ detail: CAMPAIGN_ETAG_STALE_MESSAGE }));
    expect((q('campaign-act-dialog-toggle')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);

    service.getCampaignRecord.mockReturnValue(of({ campaign: { ...CAMPAIGN, etag: '"9"' }, statusToggleEnabled: true }));
    click('campaign-act-dialog-reload');
    expect(q('campaign-act-dialog-conflict')).toBeNull();
    expect(service.getCampaignRecord).toHaveBeenCalledTimes(2);
  });

  it('withholds the toggle where the deployment cannot pause or resume', async () => {
    await setup({}, { statusToggleEnabled: false });

    expect(q('campaign-act-dialog-toggle')).toBeNull();
    expect(q('campaign-act-dialog-toggle-unavailable')?.textContent).toContain(CAMPAIGN_UNAVAILABLE_DEPLOYMENT_REASON);
  });

  // Every X row is adopted while X create is off, and upstream 409s ACTIVE on an adopted row.
  it('withholds Resume on a paused X campaign, saying where to resume it', async () => {
    await setup({}, { campaign: { ...CAMPAIGN, platform: 'twitter-ads', status: 'paused' } });

    expect(q('campaign-act-dialog-toggle')).toBeNull();
    expect(q('campaign-act-dialog-toggle-unavailable')?.textContent).toContain(CAMPAIGN_UNAVAILABLE_RESUME_PLATFORM_REASON);
  });

  it('offers the bid editor for a LinkedIn campaign and sends the bid with the record ETag', async () => {
    await setup({ lever: 'bid' });
    service.updateCampaignBid.mockReturnValue(of({ campaignId: 'c-1', bid: 2.5, bidType: 'cpc', etag: '"4"' }));

    expect(q('campaign-act-dialog-bid-unavailable')).toBeNull();
    fixture.componentInstance['changeBid']({ bid: 2.5 });
    fixture.detectChanges();

    expect(service.updateCampaignBid).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'c-1', briefId: 'b-1', bid: 2.5, bidType: 'cpc', etag: '"3"' })
    );
    expect(q('campaign-act-dialog-bid-current')?.textContent).toContain('2.5');
  });

  // An adopted X campaign records no line item, and X bids live on the line item, so campaign-service
  // refuses the write (409). The editor is withheld with where to change it; Pause and Budget stay.
  it('withholds the bid editor for an adopted X campaign and sends nothing', async () => {
    await setup({ lever: 'bid', platform: 'twitter-ads' }, { campaign: { ...CAMPAIGN, platform: 'twitter-ads', adopted: true } });

    expect(q('campaign-act-dialog-bid-unavailable')?.textContent?.trim()).toBe(CAMPAIGN_BID_UNAVAILABLE_X_ADOPTED_REASON);
    expect(fixture.debugElement.query(By.directive(CampaignBidFormComponent))).toBeNull();
    fixture.componentInstance['changeBid']({ bid: 2.5 });
    expect(service.updateCampaignBid).not.toHaveBeenCalled();
  });

  it('keeps the bid editor for an X campaign created here', async () => {
    await setup({ lever: 'bid', platform: 'twitter-ads' }, { campaign: { ...CAMPAIGN, platform: 'twitter-ads' } });

    expect(q('campaign-act-dialog-bid-unavailable')).toBeNull();
    expect(fixture.debugElement.query(By.directive(CampaignBidFormComponent))).not.toBeNull();
  });

  it('keeps Pause and Budget for an adopted X campaign', async () => {
    const adoptedX = { campaign: { ...CAMPAIGN, platform: 'twitter-ads', adopted: true } };
    await setup({ platform: 'twitter-ads' }, adoptedX);
    expect(q('campaign-act-dialog-toggle')?.textContent).toContain('Pause');

    await setup({ lever: 'budget', platform: 'twitter-ads' }, adoptedX);
    expect(q('campaign-act-dialog-budget-unavailable')).toBeNull();
    expect(fixture.debugElement.query(By.directive(CampaignBudgetFormComponent))).not.toBeNull();
  });

  it('does not refill the bid editor with a stale amount after a 412 and Reload', async () => {
    await setup({ lever: 'bid' });
    service.updateCampaignBid.mockReturnValueOnce(of({ campaignId: 'c-1', bid: 2.5, bidType: 'cpc', etag: '"4"' }));
    fixture.componentInstance['changeBid']({ bid: 2.5 });
    fixture.detectChanges();
    expect(q('campaign-act-dialog-bid-current')).not.toBeNull();

    service.updateCampaignBid.mockReturnValueOnce(throwError(() => bffError(412, 'stale')));
    fixture.componentInstance['changeBid']({ bid: 3 });
    fixture.detectChanges();
    expect(q('campaign-act-dialog-conflict')).not.toBeNull();

    service.getCampaignRecord.mockReturnValue(of({ campaign: { ...CAMPAIGN, etag: '"9"' }, statusToggleEnabled: true }));
    click('campaign-act-dialog-reload');

    // Another manager may have changed the bid: the editor starts from the reloaded row, not from 2.5.
    expect(q('campaign-act-dialog-bid-current')).toBeNull();
    const form = fixture.debugElement.query(By.directive(CampaignBidFormComponent)).componentInstance as CampaignBidFormComponent;
    expect(form.form.controls.bid.value).toBeNull();
  });

  it('does not refill the budget editor with a stale amount after a 412 and Reload', async () => {
    await setup({ lever: 'budget' });
    service.updateCampaignBudget.mockReturnValueOnce(of({ campaignId: 'c-1', budget: 100, budgetType: 'daily', etag: '"4"' }));
    fixture.componentInstance['changeBudget']({ budget: 100, budgetType: 'daily' });
    fixture.detectChanges();
    service.updateCampaignBudget.mockReturnValueOnce(throwError(() => bffError(412, 'stale')));
    fixture.componentInstance['changeBudget']({ budget: 120, budgetType: 'daily' });
    fixture.detectChanges();

    click('campaign-act-dialog-reload');

    expect(q('campaign-act-dialog-budget-current')).toBeNull();
    const form = fixture.debugElement.query(By.directive(CampaignBudgetFormComponent)).componentInstance as CampaignBudgetFormComponent;
    expect(form.initialBudget()).toBeNull();
  });

  it('withholds the budget editor for a campaign never created on its platform', async () => {
    await setup({ lever: 'budget' }, { campaign: { ...CAMPAIGN, platform_campaign_id: '' } });

    expect(q('campaign-act-dialog-budget-unavailable')).not.toBeNull();
    fixture.componentInstance['changeBudget']({ budget: 100, budgetType: 'daily' });
    expect(service.updateCampaignBudget).not.toHaveBeenCalled();
  });

  // X (#3299): campaign-service writes X budgets as a daily amount only and refuses `lifetime` with 409.
  describe('daily-only platform (X)', () => {
    const X_CAMPAIGN: CampaignServiceCampaign = { ...CAMPAIGN, platform: 'twitter-ads' };
    const setupX = (): Promise<void> => setup({ lever: 'budget', platform: 'twitter-ads' }, { campaign: X_CAMPAIGN });
    const budgetForm = (): CampaignBudgetFormComponent =>
      fixture.debugElement.query(By.directive(CampaignBudgetFormComponent)).componentInstance as CampaignBudgetFormComponent;
    const typeAmount = (value: string): void => {
      const input = (fixture.nativeElement as HTMLElement).querySelector('#campaign-budget-amount-c-1') as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const submit = (): void => {
      q('optimization-campaign-budget-form-c-1')!.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
    };

    it('offers Daily alone, with the daily-only hint, and sends the X platform hint', async () => {
      await setupX();
      service.updateCampaignBudget.mockReturnValue(of({ campaignId: 'c-1', budget: 40, budgetType: 'daily', etag: '"4"' }));

      expect(service.getCampaignSettings).toHaveBeenCalledWith('tlf', 'b-1', 'c-1');
      expect(budgetForm().dailyOnly()).toBe(true);
      expect((fixture.nativeElement as HTMLElement).querySelector('#campaign-budget-type-c-1-lifetime')).toBeNull();
      expect(q('optimization-campaign-budget-type-hint-c-1')!.textContent).toContain('daily amount only');

      typeAmount('40');
      submit();

      expect(service.updateCampaignBudget).toHaveBeenCalledWith(expect.objectContaining({ budget: 40, budgetType: 'daily', platform: 'twitter-ads' }));
    });

    it('never sends a lifetime change, even when one reaches the dialog', async () => {
      await setupX();

      fixture.componentInstance['changeBudget']({ budget: 40, budgetType: 'lifetime' });
      typeAmount('40');
      budgetForm().form.controls.budgetType.setValue('lifetime');
      submit();

      expect(service.updateCampaignBudget).not.toHaveBeenCalled();
    });

    it('cannot submit while the pacing read is out', async () => {
      await setupX();
      // Re-read the row with a pacing read that never answers.
      service.getCampaignSettings.mockReturnValue(NEVER);
      fixture.componentInstance['loadRecord']();
      fixture.detectChanges();

      expect(q('optimization-campaign-budget-blocked-c-1')!.textContent).toContain(CAMPAIGN_BUDGET_BLOCKED_PACING_CHECK_REASON);
      fixture.componentInstance['changeBudget']({ budget: 40, budgetType: 'daily' });
      expect(service.updateCampaignBudget).not.toHaveBeenCalled();
    });

    it('withholds the form, with its reason, for a lifetime-budgeted X campaign', async () => {
      await setupX();
      // Re-read the row with the platform reporting a lifetime budget.
      service.getCampaignSettings.mockReturnValue(of(settingsWith('lifetime')));
      fixture.componentInstance['loadRecord']();
      fixture.detectChanges();

      expect(q('campaign-act-dialog-budget-unavailable')!.textContent).toContain(CAMPAIGN_BUDGET_X_LIFETIME_REASON);
      expect(fixture.debugElement.query(By.directive(CampaignBudgetFormComponent))).toBeNull();
      fixture.componentInstance['changeBudget']({ budget: 40, budgetType: 'daily' });
      expect(service.updateCampaignBudget).not.toHaveBeenCalled();
    });

    it('does not read the pacing of a platform that takes either pacing', async () => {
      await setup({ lever: 'budget' });

      expect(service.getCampaignSettings).not.toHaveBeenCalled();
      expect(budgetForm().dailyOnly()).toBe(false);
    });
  });
});
