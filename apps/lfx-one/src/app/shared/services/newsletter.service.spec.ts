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

  it('posts the channel, sends the Plausible event and reports acceptance', () => {
    const accepted = vi.fn();
    service.recordShare('proj-1', 'news-1', 'linkedin').subscribe(accepted);
    const request = http.expectOne('/api/newsletters/proj-1/news-1/share');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ channel: 'linkedin' });
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(trackEvent).toHaveBeenCalledWith('newsletter_shared', { newsletterId: 'news-1', channel: 'linkedin' });
    expect(accepted).toHaveBeenCalledWith(true);
  });

  it('reports a rejected recording as false instead of erroring', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const next = vi.fn();
    const error = vi.fn();
    service.recordShare('proj-1', 'news-1', 'x').subscribe({ next, error });
    http.expectOne('/api/newsletters/proj-1/news-1/share').flush('Forbidden', { status: 403, statusText: 'Forbidden' });
    expect(next).toHaveBeenCalledWith(false);
    expect(error).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
  });
});

describe('NewsletterService.recordPageView', () => {
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

  it('posts the view and reports acceptance', () => {
    const accepted = vi.fn();
    service.recordPageView('proj-1', 'news-1').subscribe(accepted);
    const request = http.expectOne('/api/newsletters/proj-1/news-1/page-view');
    expect(request.request.method).toBe('POST');
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(accepted).toHaveBeenCalledWith(true);
  });

  it('reports a rejected recording as false instead of erroring', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const next = vi.fn();
    const error = vi.fn();
    service.recordPageView('proj-1', 'news-1').subscribe({ next, error });
    http.expectOne('/api/newsletters/proj-1/news-1/page-view').flush('Forbidden', { status: 403, statusText: 'Forbidden' });
    expect(next).toHaveBeenCalledWith(false);
    expect(error).not.toHaveBeenCalled();
  });
});

describe('NewsletterService publications (#4349)', () => {
  let http: HttpTestingController;
  let service: NewsletterService;
  const URL = '/api/projects/p-1/newsletter-publications';
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: PlausibleService, useValue: { trackEvent: vi.fn() } }],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(NewsletterService);
  });
  afterEach(() => http.verify());

  it('follows every page when listing all publications', () => {
    const result = vi.fn();
    service.listAllPublications('p-1').subscribe(result);
    http.expectOne(URL).flush({ publications: [{ id: 'a' }], next_page_token: 'next' });
    http.expectOne(`${URL}?page_token=next`).flush({ publications: [{ id: 'b' }] });
    expect(result).toHaveBeenCalledWith([{ id: 'a' }, { id: 'b' }]);
  });

  it('sends a quoted If-Match on update', () => {
    service.updatePublication('p-1', 'pub-1', 4, { name: 'Weekly update' }).subscribe();
    const request = http.expectOne(`${URL}/pub-1`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('If-Match')).toBe('"4"');
    request.flush({});
  });

  it('posts an edition under the publication', () => {
    service.createEdition('p-1', 'pub-1', { subject: 'Hello' }).subscribe();
    const request = http.expectOne(`${URL}/pub-1/editions`);
    expect(request.request.method).toBe('POST');
    request.flush({});
  });

  it('filters listed editions', () => {
    service.listEditions('p-1', 'pub-1', { status: 'draft' }).subscribe();
    http.expectOne(`${URL}/pub-1/editions?status=draft`).flush({ newsletters: [] });
  });
});
