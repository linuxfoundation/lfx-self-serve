// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { NewsletterPublicationListResponse } from '@lfx-one/shared/interfaces';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterService } from './newsletter.service';

/**
 * Covers the publication list paging walk. The upstream publication list is
 * paginated and caps the page size, so the publication-list page (which has no
 * paging controls) relies on listAllPublications to follow next_page_token.
 */
describe('NewsletterService.listAllPublications', () => {
  let get: ReturnType<typeof vi.fn>;
  let service: NewsletterService;

  beforeEach(() => {
    get = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: HttpClient, useValue: { get, post: vi.fn(), put: vi.fn(), delete: vi.fn() } }],
    });
    service = TestBed.inject(NewsletterService);
  });

  it('concatenates every page and stops when a response omits the token', async () => {
    get
      .mockReturnValueOnce(of({ publications: [{ id: 'pub-1' }], next_page_token: 'tok-1' } as NewsletterPublicationListResponse))
      .mockReturnValueOnce(of({ publications: [{ id: 'pub-2' }] } as NewsletterPublicationListResponse));

    const result = await new Promise<NewsletterPublicationListResponse>((resolve) => service.listAllPublications('proj-1').subscribe(resolve));

    expect(result.publications.map((p) => p.id)).toEqual(['pub-1', 'pub-2']);
    expect(get).toHaveBeenCalledTimes(2);
    // The second call carries the first page's token.
    expect(get.mock.calls[1][1].params.get('page_token')).toBe('tok-1');
  });

  it('follows more than ten pages — there is no artificial page cap', async () => {
    const pageCount = 15;
    for (let i = 0; i < pageCount; i++) {
      const isLast = i === pageCount - 1;
      get.mockReturnValueOnce(
        of({ publications: [{ id: `pub-${i}` }], next_page_token: isLast ? undefined : `tok-${i}` } as NewsletterPublicationListResponse)
      );
    }

    const result = await new Promise<NewsletterPublicationListResponse>((resolve) => service.listAllPublications('proj-1').subscribe(resolve));

    expect(get).toHaveBeenCalledTimes(pageCount);
    expect(result.publications.length).toBe(pageCount);
  });

  it('stops via repeated-token detection when a broken server keeps returning the same token', async () => {
    get.mockReturnValue(of({ publications: [{ id: 'pub-x' }], next_page_token: 'always' } as NewsletterPublicationListResponse));

    const result = await new Promise<NewsletterPublicationListResponse>((resolve) => service.listAllPublications('proj-1').subscribe(resolve));

    // First page (no token yet) + one page for the newly-seen 'always' token,
    // then the guard stops the walk instead of looping forever.
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.publications.length).toBe(2);
  });

  it('gives each subscription its own seen-token set', async () => {
    get
      .mockReturnValueOnce(of({ publications: [{ id: 'a-1' }], next_page_token: 'tok-a' } as NewsletterPublicationListResponse))
      .mockReturnValueOnce(of({ publications: [{ id: 'a-2' }] } as NewsletterPublicationListResponse))
      .mockReturnValueOnce(of({ publications: [{ id: 'b-1' }], next_page_token: 'tok-a' } as NewsletterPublicationListResponse))
      .mockReturnValueOnce(of({ publications: [{ id: 'b-2' }] } as NewsletterPublicationListResponse));

    const request = service.listAllPublications('proj-1');
    const first = await new Promise<NewsletterPublicationListResponse>((resolve) => request.subscribe(resolve));
    const second = await new Promise<NewsletterPublicationListResponse>((resolve) => request.subscribe(resolve));

    expect(first.publications.map((p) => p.id)).toEqual(['a-1', 'a-2']);
    expect(second.publications.map((p) => p.id)).toEqual(['b-1', 'b-2']);
  });
});
