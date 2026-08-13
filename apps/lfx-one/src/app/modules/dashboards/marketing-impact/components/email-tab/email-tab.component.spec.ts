// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EMAIL_SENDS_ROW_LIMIT } from '@lfx-one/shared/constants';

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

  async function renderCampaigns(campaigns: ReturnType<typeof campaign>[]): Promise<void> {
    const body = response(null) as unknown as { emailTypeBreakdown: { campaigns: unknown[] }[] };
    body.emailTypeBreakdown[0].campaigns = campaigns;

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EmailTabComponent],
      providers: [{ provide: AnalyticsService, useValue: { getEmailCtr: vi.fn().mockReturnValue(of(body)) } }],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailTabComponent);
    fixture.componentRef.setInput('foundationSlug', 'tlf');
    await fixture.whenStable();
    fixture.detectChanges();
  }

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

  // The query behind this table is unbounded, so a large foundation can return thousands of rows.
  // Without the cap every one is built during SSR and hydration — the scroll container bounds what
  // is visible, not what is rendered.
  it('caps the rendered rows and says so when it truncates', async () => {
    // Distinct names as well as dates: the track key is type|name|date, so repeating either would
    // produce duplicate keys and test the tracking rather than the cap.
    const many = Array.from({ length: EMAIL_SENDS_ROW_LIMIT + 25 }, (_, i) => ({
      ...campaign(`2026-07-${String((i % 28) + 1).padStart(2, '0')}`),
      campaignName: `Send ${i}`,
    }));
    await renderCampaigns(many);

    expect(fixture.nativeElement.querySelectorAll('[data-testid^="email-campaign-row-"]')).toHaveLength(EMAIL_SENDS_ROW_LIMIT);
    expect(fixture.nativeElement.textContent).toContain('latest');
  });

  // The boundary the flag exists for: a source of exactly the cap is complete, not truncated. The
  // rendered length can never exceed the cap, so comparing against it cannot tell the two apart —
  // only the pre-slice source count can.
  it('does not claim truncation when the source is exactly the cap', async () => {
    const exact = Array.from({ length: EMAIL_SENDS_ROW_LIMIT }, (_, i) => ({
      ...campaign(`2026-07-${String((i % 28) + 1).padStart(2, '0')}`),
      campaignName: `Send ${i}`,
    }));
    await renderCampaigns(exact);

    expect(fixture.nativeElement.querySelectorAll('[data-testid^="email-campaign-row-"]')).toHaveLength(EMAIL_SENDS_ROW_LIMIT);
    expect(fixture.nativeElement.textContent).not.toContain('latest');
  });

  // The ordering contract: newest first, undated last. A single-campaign fixture cannot see it.
  it('orders sends newest first and puts undated rows last', async () => {
    await renderCampaigns([
      { ...campaign('2026-07-04'), campaignName: 'Older' },
      { ...campaign(null), campaignName: 'Undated' },
      { ...campaign('2026-07-20'), campaignName: 'Newest' },
      { ...campaign('2026-07-11'), campaignName: 'Middle' },
    ]);

    // First cell of each row is the campaign name; the row's cells render without separators, so
    // read the name cell directly rather than splitting the row text.
    const names = Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="email-campaign-row-"]') as NodeListOf<HTMLElement>).map(
      (el) => el.querySelector('span')?.textContent?.trim() ?? ''
    );
    expect(names).toEqual(['Newest', 'Middle', 'Older', 'Undated']);
    expect(fixture.nativeElement.textContent).toContain('4 sends');
  });

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
