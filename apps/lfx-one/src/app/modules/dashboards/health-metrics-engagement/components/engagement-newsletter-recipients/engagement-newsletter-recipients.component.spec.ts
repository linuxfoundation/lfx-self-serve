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

// Synthetic recipients: the names are placeholders and the organizations come from the synthetic-org fixtures.
function recipient(overrides: Partial<HealthMetricsEngagementRecipient>): HealthMetricsEngagementRecipient {
  return {
    rank: 1,
    name: 'Recipient Alpha',
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
    recipient({ rank: 2, name: 'Recipient Bravo', organization: 'Vendor Corp', segment: 'not-opened', opens: 0 }),
    recipient({
      rank: 3,
      name: 'Recipient Charlie',
      organization: null,
      deliveryStatus: 'Failed',
      segment: 'failed',
      clicked: false,
      opens: null,
      clicks: null,
    }),
  ],
  truncated: false,
};

describe('EngagementNewsletterRecipientsComponent', () => {
  let fixture: ComponentFixture<EngagementNewsletterRecipientsComponent>;
  let verdicts: boolean[];

  async function render(payload: HealthMetricsEngagementNewsletterRecipients | Error = RECIPIENTS): Promise<void> {
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

  it('counts each status in the metrics row and lists recipients most engaged first', async () => {
    await render();

    expect(query('engagement-newsletter-recipients-newsletter')).toBeNull();
    expect(text('engagement-newsletter-recipients-metrics-opened-value')).toBe('1');
    expect(text('engagement-newsletter-recipients-metrics-clicked-value')).toBe('2');
    expect(text('engagement-newsletter-recipients-metrics-not-opened-value')).toBe('1');
    expect(text('engagement-newsletter-recipients-metrics-failed-value')).toBe('1');
    expect(query('engagement-newsletter-recipients-metrics-opened-tip')).not.toBeNull();
    expect(rowRanks()).toEqual(['engagement-newsletter-recipients-row-1', 'engagement-newsletter-recipients-row-2', 'engagement-newsletter-recipients-row-3']);
    expect(verdicts).toEqual([false]);
  });

  it('badges delivery and engagement, and dashes every engagement cell of a failed delivery', async () => {
    await render({ ...RECIPIENTS, recipients: [...RECIPIENTS.recipients, recipient({ rank: 4, deliveryStatus: 'Pending', segment: 'not-opened' })] });

    expect(query('engagement-newsletter-recipients-row-1-delivery')?.tagName).toBe('LFX-UI-BADGE');
    expect(text('engagement-newsletter-recipients-row-1-delivery')).toBe('Delivered');
    expect(text('engagement-newsletter-recipients-row-1-engagement')).toBe('Opened');
    expect(text('engagement-newsletter-recipients-row-4-delivery')).toBe('Pending');
    expect(text('engagement-newsletter-recipients-row-4-engagement')).toBe('Not opened');
    const failed = [...(query('engagement-newsletter-recipients-row-3')?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent?.trim());
    expect(failed.slice(1)).toEqual(['Failed', '—', '—', '—']);
  });

  it('puts the company under the name and the last open and click times under their counts', async () => {
    const now = Date.now();
    await render({
      ...RECIPIENTS,
      recipients: [
        recipient({ rank: 1, lastOpenedAt: new Date(now - 3 * 3_600_000).toISOString(), lastClickedAt: new Date(now - 2 * 86_400_000).toISOString() }),
      ],
    });

    const cells = [...(query('engagement-newsletter-recipients-row-1')?.querySelectorAll('td') ?? [])] as HTMLElement[];
    expect(cells[0].querySelector('[data-testid="health-metrics-cell-description"]')?.textContent?.trim()).toBe('Acme Motors');
    expect(cells[0].querySelector('[data-testid="health-metrics-cell-person"]')).not.toBeNull();
    const lines = (cell: HTMLElement) =>
      [...cell.querySelectorAll('[data-testid="health-metrics-cell-text"], [data-testid="health-metrics-cell-description"]')].map((part) =>
        part.textContent?.trim()
      );
    expect(lines(cells[3])).toEqual(['2', 'Last opened 3h']);
    expect(lines(cells[4])).toEqual(['5', 'Last clicked 2d']);
  });

  it('cuts to a segment and keeps the cut in the URL', async () => {
    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    expect(query('engagement-newsletter-recipients-status')?.tagName).toBe('LFX-UI-SELECT');
    fixture.componentInstance['onFilterChange']('failed');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(rowRanks()).toEqual(['engagement-newsletter-recipients-row-3']);
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { nlFilter: 'failed' }, queryParamsHandling: 'merge' }));
  });

  it('opens in the engagement order with no arrow, and sorts a count highest first with a failed delivery last', async () => {
    await render();
    const header = (key: string): HTMLElement => query(`engagement-newsletter-recipients-sort-${key}`) as HTMLElement;
    expect(['recipient', 'delivery', 'engagement', 'opens', 'clicks'].map((key) => header(key).closest('th')?.getAttribute('aria-sort'))).toEqual([
      'none',
      'none',
      'none',
      'none',
      'none',
    ]);
    const before = rowRanks();

    (header('opens').querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(rowRanks()).toEqual([before[0], before[1], before[2]]);
    (header('opens').querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(rowRanks()).toEqual([before[1], before[0], before[2]]);
  });

  it('pages the cut rather than the whole list once a filter narrows it', async () => {
    // 60 recipients, every other one clicked: the Clicked cut holds 30, still more than a page.
    await render({
      ...RECIPIENTS,
      recipients: Array.from({ length: 60 }, (_, index) => recipient({ rank: index + 1, clicked: index % 2 === 0 })),
    });
    expect(text('ui-pagination-info')).toBe('Showing 1 to 10 of 60');

    fixture.componentInstance['onFilterChange']('clicked');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text('ui-pagination-info')).toBe('Showing 1 to 10 of 30');
  });

  it('says so when the search matches no recipient, and resets the search and status from there', async () => {
    await render();

    fixture.componentInstance['onFilterChange']('opened');
    fixture.componentInstance['searchText'].set('nobody-by-this-name');
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 250));
    fixture.detectChanges();

    expect(query('engagement-newsletter-recipients-table')).toBeNull();
    expect(text('engagement-newsletter-recipients-no-match')).toContain('No recipients match this view');
    query('engagement-newsletter-recipients-no-match')?.querySelector<HTMLElement>('[data-testid="empty-state-reset-filters"]')?.click();
    expect(fixture.componentInstance['searchText']()).toBe('');
    expect(fixture.componentInstance['filter']()).toBe('all');
    // A cleared search skips the debounce, so the rows come back at once.
    TestBed.tick();
    fixture.detectChanges();
    expect(rowRanks()).toHaveLength(3);
  });

  // A page picked against the previous read must not leave a shorter one blank.
  it('shows the last page that has rows when the page is past the end of the loaded rows', async () => {
    await render({ ...RECIPIENTS, recipients: Array.from({ length: 13 }, (_, index) => recipient({ rank: index + 1 })) });

    fixture.componentInstance['page'].set(5);
    fixture.detectChanges();

    expect(rowRanks()).toHaveLength(3);
  });

  it('warns that the counts cover only the loaded recipients when the read was capped', async () => {
    await render({ ...RECIPIENTS, truncated: true });

    expect(query('engagement-newsletter-recipients-truncated')?.tagName).toBe('LFX-UI-NOTE');
    expect(text('engagement-newsletter-recipients-truncated')).toContain('Showing the 3 most engaged recipients');
  });

  it('settles empty for a foundation that has sent no newsletter', async () => {
    await render({ newsletter: null, recipients: [], truncated: false });

    expect(query('engagement-newsletter-recipients-table')).toBeNull();
    expect(verdicts).toEqual([true]);
  });

  it('says the read failed rather than reporting no newsletter', async () => {
    await render(new Error('boom'));

    expect(query('engagement-newsletter-recipients-error')).not.toBeNull();
    expect(verdicts).toEqual([false]);
  });
});
