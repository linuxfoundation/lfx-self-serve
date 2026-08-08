// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { PublicNewsletterView } from '@lfx-one/shared/interfaces';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NewsletterPublicViewComponent } from './newsletter-public-view.component';
import { NewsletterService } from '@services/newsletter.service';

function makeView(overrides: Partial<PublicNewsletterView> = {}): PublicNewsletterView {
  return {
    subject: 'January Update',
    body_html: '<p>Hello</p>',
    project_name: 'Kubernetes',
    sent_at: '2026-01-15T12:00:00Z',
    ...overrides,
  };
}

describe('NewsletterPublicViewComponent', () => {
  let component: NewsletterPublicViewComponent;
  let fixture: ComponentFixture<NewsletterPublicViewComponent>;
  let newsletterService: NewsletterService;
  let paramMap$: BehaviorSubject<Map<string, string>>;

  async function setup(
    params: [string, string][] = [
      ['projectUid', 'proj-1'],
      ['id', 'news-1'],
    ]
  ) {
    paramMap$ = new BehaviorSubject(new Map(params));
    await TestBed.configureTestingModule({
      imports: [NewsletterPublicViewComponent],
      providers: [
        { provide: NewsletterService, useValue: { getPublicView: vi.fn() } },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$ } },
      ],
    }).compileComponents();
    newsletterService = TestBed.inject(NewsletterService);
  }

  function create() {
    fixture = TestBed.createComponent(NewsletterPublicViewComponent);
    component = fixture.componentInstance;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the projection on a successful load, clearing loading/error', async () => {
    await setup();
    vi.mocked(newsletterService.getPublicView).mockReturnValue(of(makeView()));

    create();

    expect(newsletterService.getPublicView).toHaveBeenCalledWith('proj-1', 'news-1');
    expect(component['view']()).toEqual(makeView());
    expect(component['loading']()).toBe(false);
    expect(component['loadError']()).toBeNull();
  });

  it('guards a missing path param without calling the service', async () => {
    await setup([['projectUid', 'proj-1']]); // no `id`
    vi.mocked(newsletterService.getPublicView).mockReturnValue(of(makeView()));

    create();

    expect(newsletterService.getPublicView).not.toHaveBeenCalled();
    expect(component['view']()).toBeNull();
    expect(component['loading']()).toBe(false);
    expect(component['loadError']()).toContain('missing required information');
  });

  it('maps a 404 to the "no longer available" message (quietly, no console.error)', async () => {
    await setup();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(newsletterService.getPublicView).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

    create();

    expect(component['loadError']()).toBe('This newsletter is no longer available.');
    expect(component['view']()).toBeNull();
    expect(component['loading']()).toBe(false);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('maps an unexpected (non-404) error to a generic message and logs it', async () => {
    await setup();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(newsletterService.getPublicView).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    create();

    expect(component['loadError']()).toBe('Could not load this newsletter. Please try again.');
    expect(component['view']()).toBeNull();
    expect(component['loading']()).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });
});
