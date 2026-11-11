// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { Newsletter, NewsletterAudience } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterManageComponent } from './newsletter-manage.component';

const CONTEXT = { uid: 'p-1', slug: 'example-foundation', name: 'Example Foundation', logoUrl: 'logo.png' };

const DRAFT = {
  id: 'n-1',
  project_uid: 'p-1',
  version: 2,
  status: 'draft',
  subject: 'Weekly note',
  body_html: '<p>Body</p>',
  committee_uids: ['c-1'],
} as unknown as Newsletter;

const audience = (patch: Partial<NewsletterAudience>): NewsletterAudience => ({
  status: 'ready',
  recipient_count: 0,
  skipped_no_email: 0,
  committee_uids: ['c-1'],
  requested_at: '2026-11-11T00:00:00Z',
  ...patch,
});

interface AudienceApi {
  audience: () => NewsletterAudience | null;
  audienceReady: () => boolean;
  recipientCount: () => number | null;
  recipientCountLoading: () => boolean;
  handleSendError: (err: HttpErrorResponse, id: string) => void;
}

describe('NewsletterManageComponent audience snapshot (#4352)', () => {
  let newsletterService: {
    getNewsletter: ReturnType<typeof vi.fn>;
    getRecipientCount: ReturnType<typeof vi.fn>;
    resolveAudience: ReturnType<typeof vi.fn>;
    getAudience: ReturnType<typeof vi.fn>;
    getPublication: ReturnType<typeof vi.fn>;
  };
  let messageAdd: ReturnType<typeof vi.fn>;

  const openDraft = (): AudienceApi => {
    const paramMap = convertToParamMap({ id: 'n-1', projectUid: 'p-1' });
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { paramMap: of(paramMap), queryParamMap: of(convertToParamMap({})), snapshot: { paramMap, queryParamMap: convertToParamMap({}) }, parent: {} },
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(NewsletterManageComponent);
    TestBed.tick();
    return fixture.componentInstance as unknown as AudienceApi;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    newsletterService = {
      getNewsletter: vi.fn(() => of(DRAFT)),
      getRecipientCount: vi.fn(() => of({ count: 1 })),
      resolveAudience: vi.fn(() => of(audience({ recipient_count: 1580 }))),
      getAudience: vi.fn(),
      getPublication: vi.fn(),
    };
    messageAdd = vi.fn();
    TestBed.configureTestingModule({
      imports: [NewsletterManageComponent],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: NewsletterService, useValue: newsletterService },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: CommitteeService, useValue: { getCommitteesByProjectOrThrow: () => of([{ uid: 'c-1', category: 'Newsletter' }]) } },
        { provide: ProjectContextService, useValue: { activeContext: signal(CONTEXT), activeContextUid: signal('p-1') } },
        { provide: ProjectService, useValue: { getProjectStrict: () => of(null) } },
        { provide: UserService, useValue: { user: signal({ name: 'Test Editor', email: 'editor@example.com' }) } },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    });
    TestBed.overrideComponent(NewsletterManageComponent, { set: { imports: [], template: '' } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves a saved draft's audience and takes the count from the snapshot", () => {
    const api = openDraft();

    expect(newsletterService.resolveAudience).toHaveBeenCalledWith('p-1', 'n-1', { committee_uids: ['c-1'], refresh: false });
    expect(api.recipientCount()).toBe(1580);
    expect(api.audienceReady()).toBe(true);
  });

  it('holds Send while the audience is processing and releases it once the poll reads ready', () => {
    newsletterService.resolveAudience.mockReturnValue(of(audience({ status: 'processing' })));
    newsletterService.getAudience
      .mockReturnValueOnce(of(audience({ status: 'processing' })))
      .mockReturnValueOnce(of(audience({ status: 'ready', recipient_count: 17064 })));
    const api = openDraft();

    expect(api.audienceReady()).toBe(false);
    expect(api.recipientCountLoading()).toBe(true);

    vi.advanceTimersByTime(2000);
    TestBed.tick();
    expect(api.audienceReady()).toBe(false);

    vi.advanceTimersByTime(2000);
    TestBed.tick();
    expect(api.audienceReady()).toBe(true);
    expect(api.recipientCount()).toBe(17064);
    expect(api.recipientCountLoading()).toBe(false);
    expect(newsletterService.getAudience).toHaveBeenCalledTimes(2);
  });

  it('reports a failed audience and keeps Send held', () => {
    newsletterService.resolveAudience.mockReturnValue(of(audience({ status: 'failed', error: 'a selected committee returned no members' })));
    const api = openDraft();

    expect(api.audienceReady()).toBe(false);
    expect(api.recipientCount()).toBeNull();
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Could not build the recipient list' }));
  });

  it('rebuilds the audience when a send is refused as not ready', () => {
    const api = openDraft();
    newsletterService.resolveAudience.mockClear();

    api.handleSendError(new HttpErrorResponse({ status: 409, error: { upstreamCode: 'audience_not_ready', audienceStatus: 'stale' } }), 'n-1');
    TestBed.tick();

    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Preparing the recipient list' }));
    expect(newsletterService.resolveAudience).toHaveBeenCalledWith('p-1', 'n-1', { committee_uids: ['c-1'], refresh: false });
    expect(newsletterService.getNewsletter).toHaveBeenCalledTimes(1);
  });
});
