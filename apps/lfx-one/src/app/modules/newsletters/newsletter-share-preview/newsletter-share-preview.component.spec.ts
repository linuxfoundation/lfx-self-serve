// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By, Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { CONSENT_PROMPT_HIDDEN_CLASS, NEWSLETTER_SHARE_PREVIEW_FALLBACK_TITLE } from '@lfx-one/shared/constants';
import { NewsletterService } from '@services/newsletter.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterGuestModalComponent } from '../components/newsletter-guest-modal/newsletter-guest-modal.component';
import { NewsletterSharePreviewComponent } from './newsletter-share-preview.component';

const foundation = { uid: 'f-1', slug: 'acme', name: 'Acme Foundation', logo_url: null };
const guestIssue = {
  foundation,
  masked_email: 'ja***@acme***.example',
  newsletter: { id: 'news-1', subject: 'Weekly Update #42', sent_at: '2026-10-01T00:00:00Z', body_html: '<p>Hello members</p>' },
  confirmation_sent: true,
};

describe('NewsletterSharePreviewComponent', () => {
  let getNewsletterSharePreview: ReturnType<typeof vi.fn>;
  let getNewsletterGuestSharedIssue: ReturnType<typeof vi.fn>;
  let requestNewsletterGuestAccess: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<NewsletterSharePreviewComponent>;

  async function configure(platform: 'browser' | 'server' = 'browser'): Promise<void> {
    getNewsletterSharePreview = vi.fn().mockReturnValue(of({ subject: 'Weekly Update #42' }));
    getNewsletterGuestSharedIssue = vi.fn().mockReturnValue(of({ issue: null }));
    requestNewsletterGuestAccess = vi.fn();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [NewsletterSharePreviewComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        { provide: NewsletterService, useValue: { getNewsletterSharePreview, getNewsletterGuestSharedIssue, requestNewsletterGuestAccess } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ projectSlug: 'acme', id: 'news-1' }) } } },
      ],
    }).compileComponents();
  }

  beforeEach(async () => {
    await configure();
  });

  function render(): HTMLElement {
    fixture = TestBed.createComponent(NewsletterSharePreviewComponent);
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function modal(): NewsletterGuestModalComponent | undefined {
    return fixture.debugElement.query(By.directive(NewsletterGuestModalComponent))?.componentInstance;
  }

  function tag(selector: string): string | undefined {
    return TestBed.inject(Meta).getTag(selector)?.content;
  }

  it('uses the subject as both the preview title and description', () => {
    const el = render();

    expect(getNewsletterSharePreview).toHaveBeenCalledWith('acme', 'news-1');
    expect(tag('property="og:title"')).toBe('Weekly Update #42');
    expect(tag('property="og:description"')).toBe('Weekly Update #42');
    expect(tag('name="twitter:title"')).toBe('Weekly Update #42');
    expect(tag('name="twitter:description"')).toBe('Weekly Update #42');
    expect(tag('name="description"')).toBe('Weekly Update #42');
    expect(tag('property="og:type"')).toBe('article');
    expect(TestBed.inject(Title).getTitle()).toContain('Weekly Update #42');
    expect(el.querySelector('[data-testid="newsletter-share-preview-title"]')?.textContent?.trim()).toBe('Weekly Update #42');
  });

  it('falls back to a neutral card when the issue is unknown or unsent', () => {
    getNewsletterSharePreview.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

    render();

    expect(tag('property="og:title"')).toBe(NEWSLETTER_SHARE_PREVIEW_FALLBACK_TITLE);
    expect(tag('property="og:description"')).toBe(NEWSLETTER_SHARE_PREVIEW_FALLBACK_TITLE);
  });

  it('keeps the sign-in card for an issue the member benefit does not open', () => {
    const el = render();

    expect(getNewsletterGuestSharedIssue).toHaveBeenCalledWith('acme', 'news-1');
    expect(el.querySelector('[data-testid="newsletter-share-preview"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="newsletter-guest-modal"]')).toBeNull();
    // The plain sign-in card has no consent line, so the standard consent prompt is not hidden.
    expect(document.documentElement.classList.contains(CONSENT_PROMPT_HIDDEN_CLASS)).toBe(false);
  });

  it('asks a signed-out reader of a member-benefit issue for a work email over a placeholder page', () => {
    getNewsletterGuestSharedIssue.mockReturnValue(of({ issue: null, foundation, membership_name: 'Acme Foundation' }));

    const el = render();

    expect(el.querySelector('[data-testid="newsletter-guest-modal-heading"]')?.textContent).toContain(
      'Be the first to hear about new stories from Acme Foundation'
    );
    expect(el.querySelector('[data-testid="newsletter-guest-reader-placeholder"]')).not.toBeNull();
    expect(el.textContent).not.toContain('Hello members');
    expect(document.documentElement.classList.contains(CONSENT_PROMPT_HIDDEN_CLASS)).toBe(true);
    expect(el.querySelector('[data-testid="newsletter-guest-modal-sign-in"]')?.getAttribute('href')).toBe(
      `/login?returnTo=${encodeURIComponent('/newsletters/acme/news-1')}`
    );
  });

  it('shows the server teaser, not the issue body, behind the email prompt', () => {
    getNewsletterGuestSharedIssue.mockReturnValue(
      of({
        issue: null,
        foundation,
        membership_name: 'Acme Foundation',
        teaser: { subject: 'Weekly Update #42', image_url: 'https://cdn.example.com/hero.png', excerpt: 'This week in Acme' },
      })
    );

    const el = render();

    expect(el.querySelector('[data-testid="newsletter-guest-reader-teaser-subject"]')?.textContent?.trim()).toBe('Weekly Update #42');
    expect(el.querySelector('[data-testid="newsletter-guest-reader-teaser-image"]')?.getAttribute('src')).toBe('https://cdn.example.com/hero.png');
    expect(el.querySelector('[data-testid="newsletter-guest-reader-placeholder"]')).toBeNull();
    expect(el.querySelector('[data-testid="newsletter-guest-modal"]')).not.toBeNull();
  });

  it('shows the issue after Continue with a member-company email', () => {
    getNewsletterGuestSharedIssue.mockReturnValue(of({ issue: null, foundation, membership_name: 'Acme Foundation' }));
    requestNewsletterGuestAccess.mockReturnValue(of(guestIssue));
    const el = render();

    modal()!.continued.emit('jane@acme-motors.example');
    fixture.detectChanges();

    expect(requestNewsletterGuestAccess).toHaveBeenCalledWith('acme', 'news-1', 'jane@acme-motors.example');
    expect(el.querySelector('[data-testid="newsletter-guest-modal"]')).toBeNull();
    expect(el.textContent).toContain('Hello members');
    expect(el.querySelector('[data-testid="newsletter-guest-reader-confirm-note"]')?.textContent).toContain('ja***@acme***.example');
  });

  it('shows the member-benefit refusal under the email field', () => {
    getNewsletterGuestSharedIssue.mockReturnValue(of({ issue: null, foundation, membership_name: 'Acme Foundation' }));
    requestNewsletterGuestAccess.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { errors: [{ field: 'email', message: 'This newsletter is a member benefit of Acme Foundation. Use your work email, or sign in.' }] },
          })
      )
    );
    render();

    modal()!.continued.emit('jane@elsewhere.example');
    fixture.detectChanges();

    expect(modal()!.errorMessage()).toBe('This newsletter is a member benefit of Acme Foundation. Use your work email, or sign in.');
  });

  it('offers a retry, not the members-only card, when the guest lookup fails', () => {
    getNewsletterGuestSharedIssue.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    getNewsletterGuestSharedIssue.mockReturnValueOnce(of({ issue: null, foundation, membership_name: 'Acme Foundation' }));
    const el = render();

    expect(el.querySelector('[data-testid="newsletter-share-preview-error"]')).not.toBeNull();
    (el.querySelector('[data-testid="newsletter-share-preview-retry"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(getNewsletterGuestSharedIssue).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-testid="newsletter-guest-modal"]')).not.toBeNull();
  });

  it('skips the modal when the guest session already covers the issue', () => {
    getNewsletterGuestSharedIssue.mockReturnValue(of({ issue: guestIssue, foundation, membership_name: 'Acme Foundation' }));

    const el = render();

    expect(el.querySelector('[data-testid="newsletter-guest-modal"]')).toBeNull();
    expect(el.textContent).toContain('Hello members');
  });

  it('renders only the placeholder on the server, without the guest lookup', async () => {
    await configure('server');

    const el = render();

    expect(getNewsletterGuestSharedIssue).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="newsletter-guest-reader-placeholder"]')).not.toBeNull();
    expect(tag('property="og:title"')).toBe('Weekly Update #42');
  });

  it('links a visitor without JavaScript to sign in and back to the issue', () => {
    const el = render();

    expect(el.querySelector('[data-testid="newsletter-share-preview-sign-in"]')?.getAttribute('href')).toBe(
      `/login?returnTo=${encodeURIComponent('/newsletters/acme/news-1')}`
    );
  });
});
