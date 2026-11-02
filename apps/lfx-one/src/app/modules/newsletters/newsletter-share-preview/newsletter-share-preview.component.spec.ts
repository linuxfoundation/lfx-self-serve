// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { NEWSLETTER_SHARE_PREVIEW_FALLBACK_TITLE } from '@lfx-one/shared/constants';
import { NewsletterService } from '@services/newsletter.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterSharePreviewComponent } from './newsletter-share-preview.component';

describe('NewsletterSharePreviewComponent', () => {
  let getNewsletterSharePreview: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    getNewsletterSharePreview = vi.fn();
    await TestBed.configureTestingModule({
      imports: [NewsletterSharePreviewComponent],
      providers: [
        { provide: NewsletterService, useValue: { getNewsletterSharePreview } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ projectSlug: 'acme', id: 'news-1' }) } } },
      ],
    }).compileComponents();
  });

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(NewsletterSharePreviewComponent);
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function tag(selector: string): string | undefined {
    return TestBed.inject(Meta).getTag(selector)?.content;
  }

  it('uses the subject as both the preview title and description', () => {
    getNewsletterSharePreview.mockReturnValue(of({ subject: 'Weekly Update #42' }));

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

  it('links a visitor without JavaScript to sign in and back to the issue', () => {
    getNewsletterSharePreview.mockReturnValue(of({ subject: 'Weekly Update #42' }));

    const el = render();

    expect(el.querySelector('[data-testid="newsletter-share-preview-sign-in"]')?.getAttribute('href')).toBe(
      `/login?returnTo=${encodeURIComponent('/newsletters/acme/news-1')}`
    );
  });
});
