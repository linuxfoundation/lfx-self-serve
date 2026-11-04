// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NO_ERRORS_SCHEMA, PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { NewsletterAnalytics } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { EMPTY, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterFailedRecipientsDrawerComponent } from '../components/newsletter-failed-recipients-drawer/newsletter-failed-recipients-drawer.component';
import { NewsletterRecipientEngagementComponent } from '../components/newsletter-recipient-engagement/newsletter-recipient-engagement.component';
import { NewsletterAnalyticsComponent } from './newsletter-analytics.component';

function makeAnalytics(overrides: Partial<NewsletterAnalytics> = {}): NewsletterAnalytics {
  return {
    newsletter_id: 'news-1',
    subject: 'Weekly update',
    status: 'sent',
    sent_at: '2026-11-01T10:00:00Z',
    total_recipients: 20,
    delivered: 20,
    failed: 0,
    total_opens: 10,
    unique_opens: 6,
    open_rate: 0.3,
    daily_opens: [],
    ...overrides,
  };
}

describe('NewsletterAnalyticsComponent views tiles', () => {
  let fixture: ComponentFixture<NewsletterAnalyticsComponent>;
  let getAnalytics: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    getAnalytics = vi.fn();
    await TestBed.configureTestingModule({
      imports: [NewsletterAnalyticsComponent],
      providers: [
        { provide: NewsletterService, useValue: { getAnalytics } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ projectUid: 'proj-1', id: 'news-1' })), parent: null } },
        { provide: Router, useValue: { navigate: vi.fn(), events: EMPTY, url: '/', parseUrl: vi.fn(() => ({ queryParams: {} })) } },
        { provide: ProjectService, useValue: { getProjectStrict: vi.fn(() => EMPTY) } },
        { provide: ProjectContextService, useValue: {} },
        { provide: MessageService, useValue: { add: vi.fn() } },
        // Server platform: skips the browser-only chart, which these tiles don't need.
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    })
      // The drawer and per-recipient table load their own data; the tiles don't depend on them.
      .overrideComponent(NewsletterAnalyticsComponent, {
        remove: { imports: [NewsletterFailedRecipientsDrawerComponent, NewsletterRecipientEngagementComponent] },
        add: { schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();
  });

  function render(analytics: NewsletterAnalytics): HTMLElement {
    getAnalytics.mockReturnValue(of(analytics));
    fixture = TestBed.createComponent(NewsletterAnalyticsComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (el: HTMLElement, testId: string) => el.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? null;

  it('shows Page views and Total views as email opens plus page views', () => {
    const el = render(makeAnalytics({ total_opens: 10, total_page_views: 3 }));

    expect(getAnalytics).toHaveBeenCalledWith('proj-1', 'news-1');
    expect(text(el, 'newsletter-analytics-page-views')).toBe('3');
    expect(text(el, 'newsletter-analytics-total-views')).toBe('13');
  });

  it('keeps both tiles for a real zero page-view count', () => {
    const el = render(makeAnalytics({ total_opens: 0, total_page_views: 0 }));

    expect(text(el, 'newsletter-analytics-page-views')).toBe('0');
    expect(text(el, 'newsletter-analytics-total-views')).toBe('0');
  });

  it('hides both tiles while total_page_views is unknown, so Total views never shows opens alone', () => {
    const el = render(makeAnalytics({ total_opens: 10 }));

    expect(el.querySelector('[data-testid="newsletter-analytics-total-opens"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="newsletter-analytics-page-views"]')).toBeNull();
    expect(el.querySelector('[data-testid="newsletter-analytics-total-views"]')).toBeNull();
  });
});
