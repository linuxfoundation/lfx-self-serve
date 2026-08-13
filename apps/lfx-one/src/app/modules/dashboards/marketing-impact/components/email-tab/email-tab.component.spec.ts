// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { EmailCtrResponse } from '@lfx-one/shared/interfaces';

import { EmailTabComponent } from './email-tab.component';

/**
 * Covers the send-date column, whose formatter guards against bad warehouse dates.
 *
 * The guard matters because Date.UTC silently rolls out-of-range parts over: month=13 becomes
 * January of the next year, and 2026-02-31 becomes March 3rd. Either would render a confidently
 * wrong date rather than something a reader can tell is broken, so the formatter falls back to the
 * raw string instead. Nothing exercised either branch before this spec existed.
 */
describe('EmailTabComponent', () => {
  const campaign = (sendDate: string | null) => ({
    campaignName: 'Launch announcement',
    emailType: 'EVENT',
    sendDate,
    sends: 1000,
    opens: 400,
    clicks: 50,
    openRate: 40,
    ctr: 5,
    ctrStatus: 'GOOD',
  });

  const response = (sendDate: string | null): EmailCtrResponse =>
    ({
      currentCtr: 5,
      changePercentage: 0,
      momChangePercentage: null,
      trend: 'up',
      monthlyData: [],
      monthlyLabels: [],
      campaignGroups: [],
      monthlySends: [],
      monthlyOpens: [],
      emailTypeBreakdown: [
        {
          emailType: 'EVENT',
          campaignCount: 1,
          totalSends: 1000,
          totalOpens: 400,
          totalClicks: 50,
          openRate: 40,
          ctr: 5,
          performance: 'GOOD',
          campaigns: [campaign(sendDate)],
        },
      ],
    }) as unknown as EmailCtrResponse;

  let fixture: ComponentFixture<EmailTabComponent>;

  async function render(sendDate: string | null): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EmailTabComponent],
      providers: [{ provide: AnalyticsService, useValue: { getEmailCtr: vi.fn().mockReturnValue(of(response(sendDate))) } }],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailTabComponent);
    fixture.componentRef.setInput('foundationSlug', 'tlf');
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function rowText(): string {
    return fixture.nativeElement.querySelector('[data-testid="email-campaign-row-0"]')?.textContent ?? '';
  }

  it('formats a valid send date for display', async () => {
    await render('2026-07-14');

    expect(rowText()).toContain('Jul 14, 2026');
  });

  // month=13 would roll into the following January — a real date, and the wrong one.
  it('falls back to the raw value for an out-of-range month or day', async () => {
    await render('2026-13-45');

    expect(rowText()).toContain('2026-13-45');
  });

  // In range but not a real date: Date.UTC turns Feb 31 into March 3rd, which the range check
  // alone cannot catch — only comparing the constructed parts back to the input does.
  it('falls back to the raw value for an in-range date that does not exist', async () => {
    await render('2026-02-31');

    expect(rowText()).toContain('2026-02-31');
    expect(rowText()).not.toContain('Mar');
  });

  // Null is a legitimate warehouse state, not bad data — it reads as an em dash rather than a
  // blank cell, since Angular interpolates null as an empty string.
  it('renders an em dash when the row carries no send date', async () => {
    await render(null);

    expect(rowText()).toContain('—');
  });
});
