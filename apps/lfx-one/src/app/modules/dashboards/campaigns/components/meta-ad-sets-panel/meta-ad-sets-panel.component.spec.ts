// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { META_AD_SET_DELIBERATE_PAUSE_ADVICE, META_AD_SET_RESUME_ELSEWHERE_REASON } from '@lfx-one/shared/constants';
import type { CampaignServiceMetaAdSet, CampaignServiceMetaAdSets, MetaAdSetToggleOutcome, MetaAdSetToggleRequest } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MetaAdSetsPanelComponent } from './meta-ad-sets-panel.component';

describe('MetaAdSetsPanelComponent', () => {
  let fixture: ComponentFixture<MetaAdSetsPanelComponent>;
  const listMetaAdSets = vi.fn();
  let emitted: MetaAdSetToggleRequest[];

  const adSet = (over: Partial<CampaignServiceMetaAdSet> = {}): CampaignServiceMetaAdSet => ({
    id: '111',
    listed: true,
    name: 'Leads — US',
    status: 'ACTIVE',
    effective_status: 'ACTIVE',
    impressions: 0,
    clicks: 0,
    cost_micros: 0,
    ctr: 0,
    recorded: true,
    deliberately_paused: false,
    ...over,
  });

  const list = (sets: CampaignServiceMetaAdSet[]): CampaignServiceMetaAdSets => ({
    campaign_id: 'c-1',
    platform_campaign_id: '555',
    window: 'last_30_days',
    currency: 'EUR',
    read_at: '2026-10-13T09:30:00Z',
    ad_sets: sets,
    ad_set_count: sets.length,
  });

  const unconfirmedPause: MetaAdSetToggleOutcome = {
    state: 'unconfirmed',
    message: 'may or may not have been applied',
    adSetId: '111',
    adSetName: 'Leads — US',
    requestedStatus: 'PAUSED',
  };

  beforeEach(async () => {
    listMetaAdSets.mockReset();
    emitted = [];
    await TestBed.configureTestingModule({
      imports: [MetaAdSetsPanelComponent],
      providers: [provideNoopAnimations(), { provide: CampaignService, useValue: { listMetaAdSets } }],
    }).compileComponents();
  });

  function render(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(MetaAdSetsPanelComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('briefId', 'b-1');
    fixture.componentRef.setInput('campaignId', 'c-1');
    fixture.componentRef.setInput('campaignName', 'KubeCon EU');
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.componentInstance.toggleAdSet.subscribe((request) => emitted.push(request));
    fixture.detectChanges();
    fixture.detectChanges();
  }

  const q = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('renders name, status, effective status, budget and the deliberately-paused badge', () => {
    listMetaAdSets.mockReturnValue(
      of(
        list([
          adSet({ status: 'PAUSED', effective_status: 'CAMPAIGN_PAUSED', budget_type: 'lifetime', budget_amount: '900.00', deliberately_paused: true }),
          adSet({ id: '222', name: undefined, recorded: false }),
        ])
      )
    );
    render();

    expect(q('meta-ad-set-status-111')!.textContent).toContain('PAUSED');
    expect(q('meta-ad-set-status-111')!.textContent).toContain('Effective: CAMPAIGN_PAUSED');
    expect(q('meta-ad-set-budget-111')!.textContent).toContain('900.00 EUR lifetime');
    expect(q('meta-ad-set-deliberately-paused-111')).not.toBeNull();
    // An ad set with no budget of its own (Campaign Budget Optimization) and no name.
    expect(q('meta-ad-set-budget-222')!.textContent).toContain('No ad set budget');
    expect(q('meta-ad-set-row-222')!.textContent).toContain('222');
    expect(q('meta-ad-set-deliberately-paused-222')).toBeNull();
  });

  it('asks the parent for the opposite status and never acts while locked', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet()])));
    render();

    (q('meta-ad-set-toggle-111') as HTMLButtonElement).click();
    expect(emitted).toEqual([{ adSetId: '111', adSetName: 'Leads — US', status: 'PAUSED' }]);

    fixture.componentRef.setInput('pendingAdSetId', '111');
    fixture.detectChanges();
    const button = q('meta-ad-set-toggle-111') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    button.click();
    expect(emitted).toHaveLength(1);
  });

  it('is locked, and says why, while the parent blocks the row', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet()])));
    render({ blockedReason: 'Refresh the campaign list first.' });

    expect((q('meta-ad-set-toggle-111') as HTMLButtonElement).disabled).toBe(true);
    expect(q('meta-ad-sets-blocked')!.textContent).toContain('Refresh the campaign list first.');
  });

  it('offers no Resume on a paused ad set it did not create, nor on a deleted or unlisted one', () => {
    listMetaAdSets.mockReturnValue(
      of(list([adSet({ status: 'PAUSED', recorded: false }), adSet({ id: '222', status: 'DELETED' }), adSet({ id: '333', listed: false })]))
    );
    render();

    expect(q('meta-ad-set-toggle-111')).toBeNull();
    expect(q('meta-ad-set-no-action-111')!.textContent).toContain(META_AD_SET_RESUME_ELSEWHERE_REASON);
    expect(q('meta-ad-set-toggle-222')).toBeNull();
    expect(q('meta-ad-set-toggle-333')).toBeNull();
  });

  it('re-reads when the parent bumps the reload token', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet()])));
    render();
    expect(listMetaAdSets).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('reloadToken', 1);
    fixture.detectChanges();
    expect(listMetaAdSets).toHaveBeenCalledTimes(2);
  });

  it('after an unconfirmed pause, gives the advice and flags a re-read that does not show the record', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet({ status: 'PAUSED', deliberately_paused: false })])));
    render({ outcome: unconfirmedPause });

    expect(q('meta-ad-sets-deliberate-pause-advice')!.textContent).toContain(META_AD_SET_DELIBERATE_PAUSE_ADVICE);
    expect(q('meta-ad-sets-deliberate-pause-missing')!.textContent).toContain('Pause again (record)');
    expect(q('meta-ad-sets-deliberate-pause-shown')).toBeNull();
  });

  it('offers Pause again (record) beside Resume when the created ad set is paused but not recorded, and asks for PAUSED', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet({ status: 'PAUSED', deliberately_paused: false })])));
    render({ outcome: unconfirmedPause });

    expect(q('meta-ad-set-toggle-111')!.textContent).toContain('Resume');
    const record = q('meta-ad-set-record-pause-111') as HTMLButtonElement;
    expect(record.textContent).toContain('Pause again (record)');
    expect(record.getAttribute('aria-label')).toBe('Pause again (record) Leads — US');
    record.click();
    // Never ACTIVE: re-sending PAUSED records the pause and activates nothing.
    expect(emitted).toEqual([{ adSetId: '111', adSetName: 'Leads — US', status: 'PAUSED' }]);

    fixture.componentRef.setInput('pendingAdSetId', '111');
    fixture.detectChanges();
    (q('meta-ad-set-record-pause-111') as HTMLButtonElement).click();
    expect((q('meta-ad-set-record-pause-111') as HTMLButtonElement).disabled).toBe(true);
    expect(emitted).toHaveLength(1);
  });

  it.each([
    ['already recorded as deliberately paused', { status: 'PAUSED', deliberately_paused: true }],
    ['active', { status: 'ACTIVE' }],
    ['not created here', { status: 'PAUSED', recorded: false }],
  ])('offers no Pause again (record) on an ad set that is %s', (_label, over) => {
    listMetaAdSets.mockReturnValue(of(list([adSet(over as Partial<CampaignServiceMetaAdSet>)])));
    render();

    expect(q('meta-ad-set-record-pause-111')).toBeNull();
  });

  it('gives no deliberate-pause advice for an ad set whose pause is never recorded', () => {
    listMetaAdSets.mockReturnValue(of(list([adSet({ status: 'PAUSED', recorded: false })])));
    render({ outcome: unconfirmedPause });

    expect(q('meta-ad-sets-deliberate-pause-advice')).toBeNull();
  });

  it('states a failed read with a retry', () => {
    listMetaAdSets.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'Campaign not found', code: 'NOT_FOUND' } })));
    render();

    expect(q('meta-ad-sets-error')!.textContent).toContain('Campaign not found');
    listMetaAdSets.mockReturnValue(of(list([])));
    (q('meta-ad-sets-retry')!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(q('meta-ad-sets-empty')).not.toBeNull();
  });
});
