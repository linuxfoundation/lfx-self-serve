// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CampaignCreateAnotherDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignCreateAnotherDialogComponent } from './campaign-create-another-dialog.component';

describe('CampaignCreateAnotherDialogComponent (#4983)', () => {
  let fixture: ComponentFixture<CampaignCreateAnotherDialogComponent>;
  let close: ReturnType<typeof vi.fn>;
  const data: CampaignCreateAnotherDialogData = {
    summary: 'This creates a separate, separately budgeted Middle of funnel (consideration) campaign on Google Ads.',
    existing: [
      {
        id: 'g1',
        platform: 'google-ads',
        platformLabel: 'Google Ads',
        name: 'LFX | Search Campaign | g1',
        status: 'active',
        slot: '1',
        labels: { channel: 'Search', stage: 'Top of funnel', tactic: 'Prospecting', created: '—' },
      },
    ],
  };
  const q = (testId: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);

  beforeEach(async () => {
    close = vi.fn();
    await TestBed.configureTestingModule({
      imports: [CampaignCreateAnotherDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CampaignCreateAnotherDialogComponent);
    fixture.detectChanges();
  });

  it('says what will be created and lists the campaigns that already exist', () => {
    expect(q('campaign-create-another-summary')?.textContent).toContain('separately budgeted');
    expect(q('campaign-create-another-existing-g1')?.textContent).toContain('LFX | Search Campaign | g1');
  });

  /** #4983 ("ss-4"): the labels that tell the campaign being added apart from the ones that exist. */
  it("shows each existing campaign's channel, stage and tactic", () => {
    expect(q('campaign-create-another-labels-g1')?.textContent?.trim()).toBe('Channel: Search · Stage: Top of funnel · Tactic: Prospecting');
  });

  it('closes with true only on Create another, and with false on Cancel', () => {
    q('campaign-create-another-cancel')?.querySelector('button')?.click();
    expect(close).toHaveBeenLastCalledWith(false);

    q('campaign-create-another-confirm')?.querySelector('button')?.click();
    expect(close).toHaveBeenLastCalledWith(true);
  });
});
