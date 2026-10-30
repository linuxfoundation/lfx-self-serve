// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EngagementNewsletterRecipientsComponent } from './engagement-newsletter-recipients.component';

import type { HealthMetricsEngagementNewsletterRecipients, HealthMetricsEngagementRecipient } from '@lfx-one/shared/interfaces';

function recipient(overrides: Partial<HealthMetricsEngagementRecipient>): HealthMetricsEngagementRecipient {
  return {
    rank: 1,
    name: 'Maya Okonkwo',
    organization: 'Acme Motors',
    deliveryStatus: 'Delivered',
    segment: 'opened',
    clicked: true,
    opens: 2,
    lastOpenedAt: null,
    clicks: 5,
    lastClickedAt: null,
    ...overrides,
  };
}

const RECIPIENTS: HealthMetricsEngagementNewsletterRecipients = {
  newsletter: { key: 'n1', name: 'Monthly: Latest', sentDate: '2026-10-26' },
  recipients: [
    recipient({ rank: 1 }),
    recipient({ rank: 2, name: 'Daniel Reyes', organization: 'Vendor Corp', segment: 'not-opened', opens: 0 }),
    recipient({ rank: 3, name: 'Chen Yu', organization: null, deliveryStatus: 'Failed', segment: 'failed', clicked: false, opens: null, clicks: null }),
  ],
  truncated: false,
};

describe('EngagementNewsletterRecipientsComponent', () => {
  let fixture: ComponentFixture<EngagementNewsletterRecipientsComponent>;
  let counts: (number | null)[];
  let verdicts: boolean[];

  async function render(payload: HealthMetricsEngagementNewsletterRecipients | Error = RECIPIENTS): Promise<void> {
    counts = [];
    verdicts = [];
    await TestBed.configureTestingModule({
      imports: [EngagementNewsletterRecipientsComponent],
      providers: [
        provideRouter([]),
        {
          provide: AnalyticsService,
          useValue: { getEngagementNewsletterRecipients: vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload)) },
        },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EngagementNewsletterRecipientsComponent);
    fixture.componentInstance.countChange.subscribe((count) => counts.push(count));
    fixture.componentInstance.settled.subscribe((empty) => verdicts.push(empty));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string): string {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function rowRanks(): string[] {
    return [...fixture.nativeElement.querySelectorAll('[data-testid="engagement-newsletter-recipients-table"] tbody tr')].map(
      (row) => (row as HTMLElement).getAttribute('data-testid') ?? ''
    );
  }

  it('names the latest newsletter, counts each cut and lists recipients most engaged first', async () => {
    await render();

    expect(text('engagement-newsletter-recipients-newsletter')).toBe('Latest newsletter: Monthly: Latest · Sent Oct 26, 2026');
    expect(text('engagement-newsletter-recipients-filters')).toContain('Clicked (2)');
    expect(text('engagement-newsletter-recipients-count')).toBe('3 recipients');
    expect(rowRanks()).toEqual(['engagement-newsletter-recipients-row-1', 'engagement-newsletter-recipients-row-2', 'engagement-newsletter-recipients-row-3']);
    // A failed delivery shows dashes, not zeros, and a missing organization reads "—".
    const failed = [...(query('engagement-newsletter-recipients-row-3')?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent?.trim());
    expect(failed).toEqual(['Chen Yu—', 'Failed', '—', '—', '—', '—', '—']);
    expect(counts.at(-1)).toBe(3);
    expect(verdicts).toEqual([false]);
  });

  it('cuts to a segment and keeps the cut in the URL', async () => {
    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance['onFilterChange']('failed');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(rowRanks()).toEqual(['engagement-newsletter-recipients-row-3']);
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { nlFilter: 'failed' }, queryParamsHandling: 'merge' }));
  });

  it('pages the cut rather than the whole list once a filter narrows it', async () => {
    // 60 recipients, every other one clicked: the Clicked cut holds 30, still more than a page.
    await render({
      ...RECIPIENTS,
      recipients: Array.from({ length: 60 }, (_, index) => recipient({ rank: index + 1, clicked: index % 2 === 0 })),
    });
    expect(text('engagement-newsletter-recipients-table')).toContain('Showing 1 to 25 of 60');

    fixture.componentInstance['onFilterChange']('clicked');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text('engagement-newsletter-recipients-table')).toContain('Showing 1 to 25 of 30');
  });

  it('says so when the search matches no recipient, rather than showing an empty table', async () => {
    await render();

    fixture.componentInstance['searchForm'].controls.search.setValue('nobody-by-this-name');
    await new Promise((resolve) => setTimeout(resolve, 250));
    fixture.detectChanges();

    expect(query('engagement-newsletter-recipients-table')).toBeNull();
    expect(query('engagement-newsletter-recipients-no-match')).not.toBeNull();
  });

  it('warns that the counts cover only the loaded recipients when the read was capped', async () => {
    await render({ ...RECIPIENTS, truncated: true });

    expect(text('engagement-newsletter-recipients-truncated')).toContain('Showing the 3 most engaged recipients');
  });

  it('settles empty with no badge for a foundation that has sent no newsletter', async () => {
    await render({ newsletter: null, recipients: [], truncated: false });

    expect(query('engagement-newsletter-recipients-table')).toBeNull();
    expect(counts.at(-1)).toBeNull();
    expect(verdicts).toEqual([true]);
  });

  it('says the read failed rather than reporting no newsletter', async () => {
    await render(new Error('boom'));

    expect(query('engagement-newsletter-recipients-error')).not.toBeNull();
    expect(counts.at(-1)).toBeNull();
    expect(verdicts).toEqual([false]);
  });
});
