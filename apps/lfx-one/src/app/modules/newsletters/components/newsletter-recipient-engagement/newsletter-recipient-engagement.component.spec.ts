// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NewsletterRecipientEngagementResponse } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterRecipientEngagementComponent } from './newsletter-recipient-engagement.component';

const RESPONSE: NewsletterRecipientEngagementResponse = {
  newsletter_id: 'nl-1',
  total_recipients: 3,
  complete: true,
  recipients: [
    {
      name: 'Jane Doe',
      email: 'jane@acme.io',
      delivered: true,
      failed: false,
      opened: true,
      open_count: 2,
      last_opened_at: '2026-08-09T10:00:00Z',
      opened_at_list: ['2026-08-08T10:00:00Z', '2026-08-09T10:00:00Z'],
    },
    {
      email: 'bob@acme.io',
      delivered: true,
      failed: false,
      opened: false,
      open_count: 0,
      opened_at_list: [],
    },
    {
      email: 'broken@acme.io',
      delivered: false,
      failed: true,
      opened: false,
      open_count: 0,
      opened_at_list: [],
    },
  ],
};

describe('NewsletterRecipientEngagementComponent', () => {
  let fixture: ComponentFixture<NewsletterRecipientEngagementComponent>;
  let newsletterService: { getRecipientEngagement: ReturnType<typeof vi.fn> };

  async function createComponent(status: 'draft' | 'sending' | 'sent' = 'sent'): Promise<void> {
    fixture = TestBed.createComponent(NewsletterRecipientEngagementComponent);
    fixture.componentRef.setInput('projectUid', 'proj-1');
    fixture.componentRef.setInput('newsletterUid', 'nl-1');
    fixture.componentRef.setInput('status', status);
    await fixture.whenStable();
  }

  function card(testid: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
  }

  // Component debounces search input by 300ms (debounceTime(300)); the extra
  // 50ms is slack against timer jitter, not a magic number tied to nothing.
  const SEARCH_DEBOUNCE_WAIT_MS = 350;

  beforeEach(async () => {
    newsletterService = { getRecipientEngagement: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [NewsletterRecipientEngagementComponent],
      providers: [{ provide: NewsletterService, useValue: newsletterService }],
    }).compileComponents();
  });

  it('does not fetch and renders nothing for a draft newsletter', async () => {
    newsletterService.getRecipientEngagement.mockReturnValue(of(RESPONSE));

    await createComponent('draft');

    expect(newsletterService.getRecipientEngagement).not.toHaveBeenCalled();
    expect(card('newsletter-recipient-engagement')).toBeNull();
  });

  it('renders every recipient row and the chip counts once loaded', async () => {
    newsletterService.getRecipientEngagement.mockReturnValue(of(RESPONSE));

    await createComponent();

    expect(card('newsletter-recipient-engagement')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="newsletter-recipient-engagement-row-"]')).toHaveLength(3);
    expect(card('newsletter-recipient-engagement-segment-opened')?.textContent?.trim()).toBe('Opened (1)');
    expect(card('newsletter-recipient-engagement-segment-not-opened')?.textContent?.trim()).toBe('Not opened (1)');
    expect(card('newsletter-recipient-engagement-segment-failed')?.textContent?.trim()).toBe('Failed (1)');
  });

  it('filters rows to the selected engagement chip', async () => {
    newsletterService.getRecipientEngagement.mockReturnValue(of(RESPONSE));
    await createComponent();

    (card('newsletter-recipient-engagement-segment-opened') as HTMLButtonElement).click();
    await fixture.whenStable();

    const rows = fixture.nativeElement.querySelectorAll('[data-testid^="newsletter-recipient-engagement-row-"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-testid')).toBe('newsletter-recipient-engagement-row-jane@acme.io');
  });

  it('filters rows by search term across name and email', async () => {
    newsletterService.getRecipientEngagement.mockReturnValue(of(RESPONSE));
    await createComponent();

    fixture.componentInstance.filterForm.get('search')!.setValue('bob');
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_WAIT_MS));
    await fixture.whenStable();

    const rows = fixture.nativeElement.querySelectorAll('[data-testid^="newsletter-recipient-engagement-row-"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-testid')).toBe('newsletter-recipient-engagement-row-bob@acme.io');
  });

  it('toggles the open timeline for a recipient with opens, updating the expand button aria-label', async () => {
    newsletterService.getRecipientEngagement.mockReturnValue(of(RESPONSE));
    await createComponent();

    expect(card('newsletter-recipient-engagement-timeline-jane@acme.io')).toBeNull();
    const expandButton = card('newsletter-recipient-engagement-expand-jane@acme.io') as HTMLButtonElement;
    expect(expandButton.getAttribute('aria-label')).toBe('Expand open timeline for Jane Doe');

    expandButton.click();
    await fixture.whenStable();

    expect(card('newsletter-recipient-engagement-timeline-jane@acme.io')).not.toBeNull();
    expect(expandButton.getAttribute('aria-label')).toBe('Collapse open timeline for Jane Doe');

    expandButton.click();
    await fixture.whenStable();

    expect(card('newsletter-recipient-engagement-timeline-jane@acme.io')).toBeNull();
    expect(expandButton.getAttribute('aria-label')).toBe('Expand open timeline for Jane Doe');
  });

  // bob@acme.io has no `name` — displayName falls back to email, and the
  // expand affordance should only appear because RESPONSE gives bob open_count: 0.
  // Use a nameless recipient with opens to prove the aria-label fallback too.
  it('toggles the open timeline for a recipient without a name, falling back to email in the aria-label', async () => {
    newsletterService.getRecipientEngagement.mockReturnValue(
      of({
        ...RESPONSE,
        recipients: [
          {
            email: 'noname@acme.io',
            delivered: true,
            failed: false,
            opened: true,
            open_count: 1,
            last_opened_at: '2026-08-09T10:00:00Z',
            opened_at_list: ['2026-08-09T10:00:00Z'],
          },
        ],
      })
    );
    await createComponent();

    const expandButton = card('newsletter-recipient-engagement-expand-noname@acme.io') as HTMLButtonElement;
    expect(expandButton.getAttribute('aria-label')).toBe('Expand open timeline for noname@acme.io');

    expandButton.click();
    await fixture.whenStable();

    expect(card('newsletter-recipient-engagement-timeline-noname@acme.io')).not.toBeNull();
    expect(expandButton.getAttribute('aria-label')).toBe('Collapse open timeline for noname@acme.io');
  });

  it('hides the section silently on a 403 (no auditor access)', async () => {
    newsletterService.getRecipientEngagement.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));

    await createComponent();

    expect(card('newsletter-recipient-engagement')).toBeNull();
    expect(card('newsletter-recipient-engagement-error')).toBeNull();
  });

  it('hides the section silently on a 404 (endpoint not deployed yet)', async () => {
    newsletterService.getRecipientEngagement.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

    await createComponent();

    expect(card('newsletter-recipient-engagement')).toBeNull();
  });

  it('shows an inline error note on other failures instead of hiding', async () => {
    newsletterService.getRecipientEngagement.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    await createComponent();

    expect(card('newsletter-recipient-engagement-error')).not.toBeNull();
    expect(card('newsletter-recipient-engagement')).toBeNull();
  });

  it('shows the partial-data note when the upstream response is incomplete', async () => {
    newsletterService.getRecipientEngagement.mockReturnValue(of({ ...RESPONSE, complete: false, total_recipients: 10 }));

    await createComponent();

    expect(card('newsletter-recipient-engagement-partial-note')?.textContent).toContain('3 of 10');
  });
});
