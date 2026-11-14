// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CAMPAIGN_SETTINGS_READ_ERRORS } from '@lfx-one/shared/constants';
import type { CampaignIndexDoc, CampaignServiceSettingsReadback } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignSettingsDrawerComponent } from './campaign-settings-drawer.component';

const CAMPAIGN: CampaignIndexDoc = {
  id: 'c-1',
  project_id: 'p-1',
  brief_id: 'b-1',
  platform: 'linkedin-ads',
  platform_campaign_id: '123',
  campaign_name: 'KubeCon EU',
  status: 'active',
  version: 2,
};

const READBACK: CampaignServiceSettingsReadback = {
  campaign_id: 'c-1',
  platform_campaign_id: '123',
  platform: 'linkedin-ads',
  read_at: '2026-10-13T10:00:00Z',
  fields: [
    { field: 'budget_amount', recorded: '50.00', upstream: '75.00', comparison: 'diverged' },
    { field: 'campaign_name', recorded: 'KubeCon EU', upstream: 'KubeCon EU', comparison: 'match' },
    { field: 'start_date', recorded: '2026-11-01', comparison: 'unknown' },
    { field: 'unit_cost', upstream: '12.50', comparison: 'unknown' },
    { field: 'unit_cost_currency', upstream: 'EUR', comparison: 'unknown' },
  ],
  diverged_count: 1,
  unknown_count: 3,
};

describe('CampaignSettingsDrawerComponent (#3299)', () => {
  let fixture: ComponentFixture<CampaignSettingsDrawerComponent>;
  let getCampaignSettings: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    getCampaignSettings = vi.fn(() => of(READBACK));
    await TestBed.configureTestingModule({
      imports: [CampaignSettingsDrawerComponent],
      providers: [provideNoopAnimations(), { provide: CampaignService, useValue: { getCampaignSettings } }],
    }).compileComponents();
    fixture = TestBed.createComponent(CampaignSettingsDrawerComponent);
    fixture.componentRef.setInput('campaign', CAMPAIGN);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('briefId', 'b-1');
  });

  function open(): void {
    fixture.componentInstance.visible.set(true);
    fixture.detectChanges();
  }

  const q = (testId: string): HTMLElement | null => document.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => q(testId)?.textContent?.trim() ?? '';

  it('reads nothing while closed', () => {
    fixture.detectChanges();

    expect(getCampaignSettings).not.toHaveBeenCalled();
  });

  it('compares intended with live, highlights a difference and states the counts', () => {
    open();

    expect(getCampaignSettings).toHaveBeenCalledWith('tlf', 'b-1', 'c-1');
    expect(text('campaign-settings-drawer-diverged-count')).toBe('1 differ');
    expect(text('campaign-settings-drawer-match-count')).toBe('1 match');
    expect(text('campaign-settings-drawer-unknown-count')).toBe('2 not compared');
    expect(q('campaign-settings-row-budget_amount')?.classList).toContain('bg-amber-50');
    expect(text('campaign-settings-intended-budget_amount')).toBe('50.00');
    expect(text('campaign-settings-live-budget_amount')).toBe('75.00');
    expect(text('campaign-settings-verdict-budget_amount')).toContain('Differs');
  });

  it('shows unknown honestly: an absent side is "Not reported", never a match', () => {
    open();

    expect(text('campaign-settings-live-start_date')).toBe('Not reported');
    expect(text('campaign-settings-verdict-start_date')).toContain('Not compared');
    expect(text('campaign-settings-note-start_date')).toContain('did not report');
    expect(q('campaign-settings-row-start_date')?.classList).not.toContain('bg-amber-50');
  });

  it('shows the LinkedIn bid with its currency', () => {
    open();

    expect(text('campaign-settings-live-unit_cost')).toBe('12.50 EUR');
    expect(text('campaign-settings-intended-unit_cost')).toBe('Not recorded');
    expect(q('campaign-settings-row-unit_cost_currency')).toBeNull();
  });

  it('maps a refusal to a fixed message and reads again on Try again', () => {
    getCampaignSettings.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'platform text', code: 'X' } })));
    open();

    expect(text('campaign-settings-drawer-error')).toContain(CAMPAIGN_SETTINGS_READ_ERRORS[503]);
    expect(text('campaign-settings-drawer-error')).not.toContain('platform text');

    (q('campaign-settings-drawer-retry')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(getCampaignSettings).toHaveBeenCalledTimes(2);
    expect(q('campaign-settings-drawer-table')).not.toBeNull();
  });

  it("keeps campaign-service's own reason for a 409", () => {
    getCampaignSettings.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'The campaign belongs to a different ad account.', code: 'CLIENT_ERROR' } }))
    );
    open();

    expect(text('campaign-settings-drawer-error')).toContain('belongs to a different ad account');
  });
});
