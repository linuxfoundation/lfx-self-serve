// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  CAMPAIGN_ACT_AMBIGUOUS_MESSAGE,
  CAMPAIGN_ACT_META_RESUME_NOTE,
  CAMPAIGN_ACT_RESOLVE_UNAVAILABLE_MESSAGE,
  CAMPAIGN_ACT_RESOLVE_UNEXPECTED_MESSAGE,
  CAMPAIGN_ACT_RESUME_ADOPTED_NOTE,
  CAMPAIGN_ACT_UNOWNED_MESSAGE,
  CAMPAIGN_ETAG_STALE_MESSAGE,
  CAMPAIGN_UNAVAILABLE_DEPLOYMENT_REASON,
} from '@lfx-one/shared/constants';
import type {
  CampaignActDialogData,
  CampaignRecordResult,
  CampaignServiceCampaign,
  CampaignServiceCampaignResolution,
  CampaignStatusToggleParams,
} from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

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

  it("shows campaign-service's own refusal for a resume (an adopted campaign) and does not retry it", async () => {
    await setup({}, { campaign: { ...CAMPAIGN, status: 'paused' } });
    service.updateCampaignStatus.mockReturnValue(
      throwError(() => bffError(409, 'This campaign was adopted; activate it in the ad platform.')) as Observable<never>
    );

    click('campaign-act-dialog-toggle');

    expect(q('campaign-act-dialog-toggle-error')?.textContent).toContain('This campaign was adopted');
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

  it('withholds the budget editor for a campaign never created on its platform', async () => {
    await setup({ lever: 'budget' }, { campaign: { ...CAMPAIGN, platform_campaign_id: '' } });

    expect(q('campaign-act-dialog-budget-unavailable')).not.toBeNull();
    fixture.componentInstance['changeBudget']({ budget: 100, budgetType: 'daily' });
    expect(service.updateCampaignBudget).not.toHaveBeenCalled();
  });
});
