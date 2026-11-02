// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MyNewslettersApiResponse } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewsletterService } from './newsletter.service';
import { PlausibleService } from './plausible.service';

describe('NewsletterService personal feed', () => {
  let http: HttpTestingController;
  let service: NewsletterService;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: PlausibleService, useValue: { trackEvent: vi.fn() } }],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(NewsletterService);
  });
  afterEach(() => http.verify());
  it.each<MyNewslettersApiResponse>([{ newsletters: [], complete: false }, [{ id: 'issue', project_uid: 'owner', subject: 'Legacy' }]])(
    'requests status and passes the response through: %j',
    (response) => {
      const next = vi.fn();
      service.getMyNewsletters().subscribe(next);
      const request = http.expectOne('/api/newsletters/my-newsletters?include_status=true');
      expect(request.request.method).toBe('GET');
      request.flush(response);
      expect(next).toHaveBeenCalledWith(response);
    }
  );
  it('propagates HTTP failures instead of reporting an empty feed', () => {
    const next = vi.fn();
    const error = vi.fn();
    service.getMyNewsletters().subscribe({ next, error });
    http.expectOne('/api/newsletters/my-newsletters?include_status=true').flush('Unavailable', { status: 503, statusText: 'Unavailable' });
    expect(next).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.any(HttpErrorResponse));
    expect(error.mock.calls[0][0].status).toBe(503);
  });
});

describe('NewsletterService.recordShare (#4958)', () => {
  let http: HttpTestingController;
  let service: NewsletterService;
  let trackEvent: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    trackEvent = vi.fn();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: PlausibleService, useValue: { trackEvent } }],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(NewsletterService);
  });
  afterEach(() => http.verify());

  it('posts the channel and sends the Plausible event', () => {
    service.recordShare('proj-1', 'news-1', 'linkedin');
    const request = http.expectOne('/api/newsletters/proj-1/news-1/share');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ channel: 'linkedin' });
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(trackEvent).toHaveBeenCalledWith('newsletter_shared', { newsletterId: 'news-1', channel: 'linkedin' });
  });

  it('swallows a failed recording so sharing never errors', () => {
    expect(() => {
      service.recordShare('proj-1', 'news-1', 'x');
      http.expectOne('/api/newsletters/proj-1/news-1/share').flush('Forbidden', { status: 403, statusText: 'Forbidden' });
    }).not.toThrow();
  });
});
