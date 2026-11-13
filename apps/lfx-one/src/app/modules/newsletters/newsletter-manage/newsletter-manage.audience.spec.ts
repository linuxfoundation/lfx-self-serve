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
import { firstValueFrom, Observable, of, Subject, throwError } from 'rxjs';
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
  form: { patchValue: (v: Record<string, unknown>) => void };
  saveDraft: (isManual?: boolean) => Observable<unknown>;
  newsletterStatus: { set: (s: string) => void };
  recipientsNewsletterUid: () => string | null;
  audience: () => NewsletterAudience | null;
  audienceReady: () => boolean;
  recipientCount: () => number | null;
  recipientCountLoading: () => boolean;
  handleSendError: (err: HttpErrorResponse, id: string) => void;
  onAddAudienceEmail: (raw: string) => void;
  canSend: () => boolean;
  audiencePreparing: () => boolean;
}

describe('NewsletterManageComponent audience snapshot (#4352)', () => {
  let newsletterService: {
    createNewsletter: ReturnType<typeof vi.fn>;
    getNewsletter: ReturnType<typeof vi.fn>;
    getRecipientCount: ReturnType<typeof vi.fn>;
    resolveAudience: ReturnType<typeof vi.fn>;
    getAudience: ReturnType<typeof vi.fn>;
    getPublication: ReturnType<typeof vi.fn>;
  };
  let messageAdd: ReturnType<typeof vi.fn>;
  let createCommitteeMember: ReturnType<typeof vi.fn>;
  let destroyPage: () => void;

  const openDraft = (params: Record<string, string> = { id: 'n-1', projectUid: 'p-1' }): AudienceApi => {
    const paramMap = convertToParamMap(params);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { paramMap: of(paramMap), queryParamMap: of(convertToParamMap({})), snapshot: { paramMap, queryParamMap: convertToParamMap({}) }, parent: {} },
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(NewsletterManageComponent);
    destroyPage = () => fixture.destroy();
    TestBed.tick();
    return fixture.componentInstance as unknown as AudienceApi;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    newsletterService = {
      createNewsletter: vi.fn(() => of({ ...DRAFT, version: 1 })),
      getNewsletter: vi.fn(() => of(DRAFT)),
      getRecipientCount: vi.fn(() => of({ count: 1 })),
      resolveAudience: vi.fn(() => of(audience({ recipient_count: 1580 }))),
      getAudience: vi.fn(),
      getPublication: vi.fn(),
    };
    messageAdd = vi.fn();
    createCommitteeMember = vi.fn(() => of({}));
    TestBed.configureTestingModule({
      imports: [NewsletterManageComponent],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: NewsletterService, useValue: newsletterService },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        {
          provide: CommitteeService,
          useValue: {
            getCommitteesByProjectOrThrow: () =>
              of([
                { uid: 'c-1', category: 'Newsletter' },
                { uid: 'c-2', category: 'Newsletter' },
              ]),
            createCommitteeMember,
          },
        },
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

    // The first status check runs straight away and still reads processing.
    expect(api.audienceReady()).toBe(false);
    expect(api.recipientCountLoading()).toBe(true);
    expect(api.recipientsNewsletterUid()).toBeNull();
    expect(api.audiencePreparing()).toBe(true);

    vi.advanceTimersByTime(2000);
    TestBed.tick();
    expect(api.audienceReady()).toBe(true);
    expect(api.recipientsNewsletterUid()).toBe('n-1');
    expect(api.recipientCount()).toBe(17064);
    expect(api.recipientCountLoading()).toBe(false);
    expect(api.audiencePreparing()).toBe(false);
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

  it('resolves the audience of a draft created on this page', async () => {
    const api = openDraft({});
    newsletterService.resolveAudience.mockClear();
    api.form.patchValue({ committeeUids: ['c-1'], subject: 'Weekly note', bodyHtml: '<p>Body</p>' });
    TestBed.tick();

    await firstValueFrom(api.saveDraft(true));
    TestBed.tick();

    expect(newsletterService.resolveAudience).toHaveBeenCalledWith('p-1', 'n-1', { committee_uids: ['c-1'], refresh: false });
    expect(api.audienceReady()).toBe(true);
  });

  it('resolves the audience again when a scheduled newsletter is back in drafts', () => {
    newsletterService.getNewsletter.mockReturnValue(of({ ...DRAFT, status: 'scheduled' }));
    const api = openDraft();
    expect(newsletterService.resolveAudience).not.toHaveBeenCalled();

    api.newsletterStatus.set('draft');
    TestBed.tick();

    expect(newsletterService.resolveAudience).toHaveBeenCalledWith('p-1', 'n-1', { committee_uids: ['c-1'], refresh: false });
    expect(api.audienceReady()).toBe(true);
  });

  it('reports an audience request that fails', () => {
    newsletterService.resolveAudience.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    const api = openDraft();

    expect(api.audienceReady()).toBe(false);
    expect(api.audiencePreparing()).toBe(false);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Could not build the recipient list' }));
  });

  it('reports an audience that is still processing when the checks run out', () => {
    newsletterService.resolveAudience.mockReturnValue(of(audience({ status: 'processing' })));
    newsletterService.getAudience.mockReturnValue(of(audience({ status: 'processing' })));
    const api = openDraft();

    vi.advanceTimersByTime(2000 * 300);
    TestBed.tick();

    expect(api.audienceReady()).toBe(false);
    expect(api.recipientCountLoading()).toBe(false);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Still preparing the recipient list' }));
  });

  it('holds Send from the moment an added email starts a rebuild until the rebuilt snapshot is ready', () => {
    const api = openDraft();
    expect(api.audienceReady()).toBe(true);
    const rebuilt = new Subject<NewsletterAudience>();
    newsletterService.resolveAudience.mockReturnValue(rebuilt);

    api.onAddAudienceEmail('new.member@example.com');
    TestBed.tick();

    expect(newsletterService.resolveAudience).toHaveBeenLastCalledWith('p-1', 'n-1', { committee_uids: ['c-1'], refresh: true });
    expect(api.audienceReady()).toBe(false);
    expect(api.canSend()).toBe(false);

    rebuilt.next(audience({ recipient_count: 1581 }));
    rebuilt.complete();
    TestBed.tick();
    expect(api.audienceReady()).toBe(true);
    expect(api.recipientCount()).toBe(1581);
  });

  it('rebuilds a group whose add finished while another group was selected', () => {
    const api = openDraft();
    const add = new Subject<unknown>();
    createCommitteeMember.mockReturnValue(add);
    api.onAddAudienceEmail('new.member@example.com');

    // The author picks another group before the add finishes, then comes back.
    api.form.patchValue({ committeeUids: ['c-2'] });
    add.next({});
    add.complete();
    expect(newsletterService.resolveAudience).toHaveBeenCalledTimes(1);

    api.form.patchValue({ committeeUids: ['c-1'] });
    vi.advanceTimersByTime(300);
    TestBed.tick();
    expect(newsletterService.resolveAudience).toHaveBeenLastCalledWith('p-1', 'n-1', { committee_uids: ['c-1'], refresh: true });
  });

  it('rebuilds again when a rebuild gets back a read that started before the add', () => {
    newsletterService.resolveAudience
      .mockReturnValueOnce(of(audience({ status: 'processing', requested_at: 'read-1' })))
      .mockReturnValueOnce(of(audience({ status: 'processing', requested_at: 'read-1' })))
      .mockReturnValueOnce(of(audience({ status: 'processing', requested_at: 'read-2' })));
    newsletterService.getAudience
      .mockReturnValueOnce(of(audience({ recipient_count: 1580 })))
      .mockReturnValueOnce(of(audience({ recipient_count: 1580 })))
      .mockReturnValueOnce(of(audience({ recipient_count: 1581 })));
    const api = openDraft();
    expect(api.recipientCount()).toBe(1580);

    api.onAddAudienceEmail('new.member@example.com');
    TestBed.tick();

    // The service handed back read-1, which predates the add, so the page asked again.
    expect(newsletterService.resolveAudience).toHaveBeenCalledTimes(3);
    expect(newsletterService.resolveAudience).toHaveBeenLastCalledWith('p-1', 'n-1', { committee_uids: ['c-1'], refresh: true });
    expect(api.recipientCount()).toBe(1581);
    expect(api.audienceReady()).toBe(true);
  });

  it('resolves again rather than accept a finished read for other committees', () => {
    newsletterService.resolveAudience
      .mockReturnValueOnce(of(audience({ status: 'processing', committee_uids: ['c-9'] })))
      .mockReturnValueOnce(of(audience({ recipient_count: 1580 })));
    newsletterService.getAudience.mockReturnValueOnce(of(audience({ committee_uids: ['c-9'], recipient_count: 42 })));
    const api = openDraft();

    expect(newsletterService.resolveAudience).toHaveBeenCalledTimes(2);
    expect(api.recipientCount()).toBe(1580);
    expect(api.audienceReady()).toBe(true);
  });

  it('rebuilds once more when a second add cancels a rebuild request that had not answered', () => {
    newsletterService.resolveAudience
      .mockReturnValueOnce(of(audience({ recipient_count: 1580 })))
      .mockReturnValueOnce(new Subject<NewsletterAudience>())
      .mockReturnValueOnce(of(audience({ status: 'processing', requested_at: 'read-1' })))
      .mockReturnValueOnce(of(audience({ status: 'processing', requested_at: 'read-2' })));
    newsletterService.getAudience.mockReturnValueOnce(of(audience({ recipient_count: 1581 }))).mockReturnValueOnce(of(audience({ recipient_count: 1582 })));
    const api = openDraft();

    api.onAddAudienceEmail('first@example.com');
    TestBed.tick();
    api.onAddAudienceEmail('second@example.com');
    TestBed.tick();

    // read-1 may be the read the cancelled request started, before the second add, so the page asked again.
    expect(newsletterService.resolveAudience).toHaveBeenCalledTimes(4);
    expect(api.recipientCount()).toBe(1582);
    expect(api.audienceReady()).toBe(true);
  });

  it('starts the rebuild itself when an add finishes after the author left the page', () => {
    const api = openDraft();
    const add = new Subject<unknown>();
    createCommitteeMember.mockReturnValue(add);
    api.onAddAudienceEmail('late@example.com');
    newsletterService.resolveAudience.mockClear();
    newsletterService.resolveAudience.mockReturnValue(of(audience({ status: 'processing' })));

    newsletterService.getAudience.mockReturnValue(of(audience({ recipient_count: 1580 })));

    destroyPage();
    add.next({});
    add.complete();

    // The first request got a running read back, which may predate the add, so it waited and asked again.
    expect(newsletterService.resolveAudience).toHaveBeenCalledTimes(2);
    expect(newsletterService.resolveAudience).toHaveBeenNthCalledWith(2, 'p-1', 'n-1', { committee_uids: ['c-1'], refresh: true });
  });
});
