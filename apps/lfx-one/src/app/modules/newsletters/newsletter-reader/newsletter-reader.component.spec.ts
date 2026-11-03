// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { MyNewsletterFoundation, MyNewsletterFoundationsResponse, Newsletter, NewsletterJoinResult, Project } from '@lfx-one/shared/interfaces';
import { NEWSLETTER_INVITE_RELOOKUP_DELAY_MS } from '@lfx-one/shared/constants';
import { ProjectStage } from '@lfx-one/shared/enums';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, NEVER, of, Subject, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { NewsletterReaderComponent } from './newsletter-reader.component';
import { ProjectService } from '@services/project.service';
import { NewsletterService } from '@services/newsletter.service';
import { ShareDialogService } from '@services/share-dialog.service';
import { LensService } from '@services/lens.service';
import { DialogService } from 'primeng/dynamicdialog';

import { NewsletterInviteDialogComponent } from '../components/newsletter-invite-dialog/newsletter-invite-dialog.component';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    uid: 'proj-123',
    slug: 'kubernetes',
    description: 'Test project',
    name: 'Kubernetes',
    writer: false,
    public: true,
    parent_uid: '',
    stage: ProjectStage.Active,
    category: 'test',
    funding_model: [],
    charter_url: '',
    legal_entity_type: '',
    legal_entity_name: '',
    legal_parent_uid: '',
    autojoin_enabled: false,
    formation_date: '2020-01-01',
    logo_url: '',
    repository_url: '',
    website_url: '',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    mailing_list_count: 0,
    ...overrides,
  };
}

function makeNewsletter(overrides: Partial<Newsletter> = {}): Newsletter {
  return {
    id: 'news-123',
    project_uid: 'proj-123',
    subject: 'Test',
    body_html: '<p>Test</p>',
    ed_reply_email: 'ed@example.com',
    committee_uids: [],
    status: 'sent',
    sent_at: '2026-08-13T10:00:00Z',
    total_recipients: 12,
    created_by: 'sender',
    version: 1,
    created_at: '2026-08-13T10:00:00Z',
    updated_at: '2026-08-13T10:00:00Z',
    ...overrides,
  };
}

function makeFoundation(overrides: Partial<MyNewsletterFoundation> = {}): MyNewsletterFoundation {
  return {
    uid: 'proj-123',
    slug: 'kubernetes',
    name: 'Kubernetes',
    logo_url: null,
    received_count: 3,
    last_sent_at: '2026-08-13T10:00:00Z',
    newsletter_group: { uid: 'group-1', name: 'Kubernetes Newsletter' },
    can_invite: true,
    membership_name: 'The Linux Foundation',
    ...overrides,
  };
}

function makeFoundationsResponse(overrides: Partial<MyNewsletterFoundationsResponse> = {}): MyNewsletterFoundationsResponse {
  return {
    foundations: [makeFoundation()],
    newsletters: [],
    complete: true,
    inviter: { eligible: true, company_name: 'Acme Motors' },
    ...overrides,
  };
}

describe('NewsletterReaderComponent', () => {
  let component: NewsletterReaderComponent;
  let fixture: ComponentFixture<NewsletterReaderComponent>;
  let projectService: ProjectService;
  let newsletterService: NewsletterService;
  let paramMap$: BehaviorSubject<Map<string, string>>;
  let dialogService: { open: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const mockProjectService = {
      getProjectStrict: vi.fn(),
    };
    const mockNewsletterService = {
      getReaderAccess: vi.fn(),
      joinNewsletterGroup: vi.fn(),
      getMyNewsletterFoundations: vi.fn().mockReturnValue(of(makeFoundationsResponse({ foundations: [] }))),
      recordShare: vi.fn().mockReturnValue(of(true)),
      recordPageView: vi.fn().mockReturnValue(of(true)),
    };
    dialogService = { open: vi.fn() };
    const mockShareDialogService = {
      open: vi.fn(),
    };

    paramMap$ = new BehaviorSubject(
      new Map([
        ['projectSlug', 'kubernetes'],
        ['id', 'news-123'],
      ])
    );
    const activatedRoute = {
      paramMap: paramMap$,
    };

    await TestBed.configureTestingModule({
      imports: [NewsletterReaderComponent],
      providers: [
        { provide: ProjectService, useValue: mockProjectService },
        { provide: NewsletterService, useValue: mockNewsletterService },
        { provide: ActivatedRoute, useValue: activatedRoute },
        { provide: ShareDialogService, useValue: mockShareDialogService },
        { provide: LensService, useValue: { setLens: vi.fn().mockReturnValue(true) } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        provideNoopAnimations(),
      ],
    })
      .overrideComponent(NewsletterReaderComponent, { set: { providers: [{ provide: DialogService, useValue: dialogService }] } })
      .compileComponents();

    projectService = TestBed.inject(ProjectService);
    newsletterService = TestBed.inject(NewsletterService);
  });

  it('should create', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    expect(component).toBeTruthy();
  });

  it('should initialize with loading true', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    expect(component['loading']()).toBe(true);
  });

  it('should render draft newsletter when user is a writer', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject({ writer: true })));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(
      of({ access: 'manager', newsletter: makeNewsletter({ subject: 'Draft', body_html: '<p>Draft content</p>', status: 'draft' }) })
    );

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    // Verify component created and injections wired
    expect(component).toBeTruthy();
    expect(component['project']).toBeDefined();
    expect(component['newsletter']).toBeDefined();
  });

  it('should call getProject with slug from route params', () => {
    const getProjectSpy = vi.mocked(projectService.getProjectStrict);
    getProjectSpy.mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    // Service should be called as route params are emitted
    expect(getProjectSpy).toHaveBeenCalled();
  });

  it('should reset to loading when route params change to another issue', () => {
    // First call resolves the initial issue; every later call (the param
    // change re-fires combineLatest per source signal) hangs, keeping the
    // second load in flight.
    vi.mocked(projectService.getProjectStrict).mockReturnValueOnce(of(makeProject())).mockReturnValue(NEVER);
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    TestBed.tick();

    // First issue fully loaded
    expect(component['loading']()).toBe(false);
    expect(component['newsletter']()).not.toBeNull();

    // Navigate to another permalink: the component is reused, so the state
    // must reset to the skeleton instead of showing the stale issue.
    paramMap$.next(
      new Map([
        ['projectSlug', 'other-project'],
        ['id', 'news-456'],
      ])
    );
    TestBed.tick();

    expect(component['loading']()).toBe(true);
    expect(component['newsletter']()).toBeNull();
  });

  it('should map a 404 newsletter fetch to the not-found state, not error', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    TestBed.tick();

    expect(component['loading']()).toBe(false);
    expect(component['error']()).toBe(false);
    expect(component['notFound']()).toBe(true);
  });

  it('should surface a 5xx newsletter fetch as error, not a permanent 404', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    TestBed.tick();

    expect(component['loading']()).toBe(false);
    expect(component['error']()).toBe(true);
    expect(component['notFound']()).toBe(false);
  });

  it('should map a 404 project lookup (bad slug) to the not-found state', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    TestBed.tick();

    expect(component['loading']()).toBe(false);
    expect(component['error']()).toBe(false);
    expect(component['notFound']()).toBe(true);
  });

  it('should surface a project-service outage as error, not a permanent 404', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    TestBed.tick();

    expect(component['loading']()).toBe(false);
    expect(component['error']()).toBe(true);
    expect(component['notFound']()).toBe(false);
  });

  it('should eagerly select me for the current tab and persisted preference before navigation', () => {
    // Eager Me selection updates the current tab and persisted preference;
    // route data restores Me independently of the cookie.
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;

    const lensService = TestBed.inject(LensService);
    const router = TestBed.inject(Router);
    component['goToMyNewsletters'](new MouseEvent('click', { button: 0 }));

    expect(lensService.setLens).toHaveBeenCalledWith('me');
    expect(router.navigate).toHaveBeenCalledWith(['/newsletters/my']);
    // Select Me before navigating so current-tab state and the persisted
    // preference update eagerly.
    expect(vi.mocked(lensService.setLens).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(router.navigate).mock.invocationCallOrder[0]);
  });

  it('should leave modified clicks on the breadcrumb to the browser (new tab)', () => {
    // Keep native new-tab navigation: route data restores Me without the cookie.
    // Eager selection updates the current tab and persisted preference.
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;

    const lensService = TestBed.inject(LensService);
    const router = TestBed.inject(Router);
    const event = new MouseEvent('click', { button: 0, metaKey: true, cancelable: true });
    component['goToMyNewsletters'](event);

    expect(lensService.setLens).toHaveBeenCalledWith('me');
    expect(event.defaultPrevented).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('opens the share dialog with the permalink and the issue subject', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter({ subject: 'K8s Weekly #42' }) }));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="newsletter-reader-share"]')!.click();

    expect(TestBed.inject(ShareDialogService).open).toHaveBeenCalledWith({
      url: expect.stringContaining('/newsletters/kubernetes/news-123'),
      title: 'K8s Weekly #42',
      copiedMessage: 'Newsletter link copied to clipboard.',
      onShare: expect.any(Function),
    });
  });

  it('shows the share count and records shares, counting each channel once (#4958)', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter({ share_count: 7 }) }));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const shareCount = () => el.querySelector('[data-testid="newsletter-reader-share-count"]')?.textContent?.trim();
    expect(shareCount()).toBe('7');

    el.querySelector<HTMLButtonElement>('[data-testid="newsletter-reader-share"]')!.click();
    const { onShare } = vi.mocked(TestBed.inject(ShareDialogService).open).mock.calls[0][0];
    onShare!('linkedin');
    onShare!('linkedin');
    onShare!('copy_link');
    fixture.detectChanges();

    expect(newsletterService.recordShare).toHaveBeenCalledWith('proj-123', 'news-123', 'linkedin');
    expect(newsletterService.recordShare).toHaveBeenCalledTimes(3);
    expect(shareCount()).toBe('9');
  });

  it('shows views from total_opens on the engagement rail, beside the issue rather than in the header', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(
      of({ access: 'group_member', newsletter: makeNewsletter({ total_opens: 1248, share_count: 4 }) })
    );

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="newsletter-reader-views-count"]')!.textContent!.trim()).toBe('1,248');
    expect(el.querySelector('[data-testid="newsletter-reader-views"]')!.getAttribute('aria-label')).toBe('Viewed 1,248 times');
    const rail = el.querySelector('[data-testid="newsletter-reader-engagement-rail"]')!;
    expect(rail.querySelector('[data-testid="newsletter-reader-share"]')).not.toBeNull();
    expect(el.querySelector('lfx-newsletter-share-button')).toBeNull();
  });

  it('shows views as email opens plus unique web page views', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(
      of({ access: 'group_member', newsletter: makeNewsletter({ total_opens: 1248, page_view_count: 52 }) })
    );

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="newsletter-reader-views-count"]')!.textContent!.trim()).toBe('1,300');
  });

  it('shows page views alone when total_opens is unknown', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter({ page_view_count: 7 }) }));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="newsletter-reader-views-count"]')!.textContent!.trim()).toBe('7');
  });

  describe('page views', () => {
    it('records one page view for a readable sent issue, however often the page re-renders', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));

      fixture = TestBed.createComponent(NewsletterReaderComponent);
      fixture.detectChanges();
      TestBed.tick();
      fixture.detectChanges();
      TestBed.tick();

      expect(newsletterService.recordPageView).toHaveBeenCalledTimes(1);
      expect(newsletterService.recordPageView).toHaveBeenCalledWith('proj-123', 'news-123');
    });

    it('records again when the reader navigates to another issue', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockImplementation((_project, id) => of({ access: 'group_member', newsletter: makeNewsletter({ id }) }));

      fixture = TestBed.createComponent(NewsletterReaderComponent);
      fixture.detectChanges();
      TestBed.tick();
      paramMap$.next(
        new Map([
          ['projectSlug', 'kubernetes'],
          ['id', 'news-456'],
        ])
      );
      fixture.detectChanges();
      TestBed.tick();

      expect(newsletterService.recordPageView).toHaveBeenCalledTimes(2);
      expect(newsletterService.recordPageView).toHaveBeenLastCalledWith('proj-123', 'news-456');
    });

    it('does not record a view when access is denied', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'denied', denied_reason: 'not_member_company' }));

      fixture = TestBed.createComponent(NewsletterReaderComponent);
      fixture.detectChanges();
      TestBed.tick();

      expect(newsletterService.recordPageView).not.toHaveBeenCalled();
    });

    it('does not record a view of a draft a manager is previewing', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject({ writer: true })));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(
        of({ access: 'manager', newsletter: makeNewsletter({ status: 'draft', sent_at: undefined }) })
      );

      fixture = TestBed.createComponent(NewsletterReaderComponent);
      fixture.detectChanges();
      TestBed.tick();

      expect(newsletterService.recordPageView).not.toHaveBeenCalled();
    });
  });

  it('hides views while total_opens is unknown but keeps the Share button', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="newsletter-reader-views"]')).toBeNull();
    expect(el.querySelector('[data-testid="newsletter-reader-share"]')).not.toBeNull();
  });

  it('records a share against the issue the dialog opened for, even after Back/Forward', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockImplementation((_project, id) =>
      of({ access: 'group_member', newsletter: makeNewsletter({ id, share_count: 7 }) })
    );

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('[data-testid="newsletter-reader-share"]')!.click();
    const { onShare } = vi.mocked(TestBed.inject(ShareDialogService).open).mock.calls[0][0];

    paramMap$.next(
      new Map([
        ['projectSlug', 'kubernetes'],
        ['id', 'news-456'],
      ])
    );
    fixture.detectChanges();
    onShare!('reddit');
    fixture.detectChanges();

    expect(newsletterService.recordShare).toHaveBeenCalledWith('proj-123', 'news-123', 'reddit');
    expect(el.querySelector('[data-testid="newsletter-reader-share-count"]')!.textContent!.trim()).toBe('7');
  });

  it('leaves the count alone when the server does not accept the share', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter({ share_count: 7 }) }));
    vi.mocked(newsletterService.recordShare).mockReturnValue(of(false));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('[data-testid="newsletter-reader-share"]')!.click();
    vi.mocked(TestBed.inject(ShareDialogService).open).mock.calls[0][0].onShare!('x');
    fixture.detectChanges();

    expect(newsletterService.recordShare).toHaveBeenCalledWith('proj-123', 'news-123', 'x');
    expect(el.querySelector('[data-testid="newsletter-reader-share-count"]')!.textContent!.trim()).toBe('7');
  });

  describe('member benefit (#3469)', () => {
    const eligibleAccess = {
      access: 'eligible' as const,
      newsletter: makeNewsletter(),
      qualifying_email: 'jane@acme-motors.example',
      company_name: 'Acme Motors',
      committee_name: 'LF Weekly',
    };

    it('shows the draft notice when the server 404s an unsent issue', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'not found', code: 'NEWSLETTER_NOT_SENT' } }))
      );

      fixture = TestBed.createComponent(NewsletterReaderComponent);
      component = fixture.componentInstance;
      TestBed.tick();

      expect(component['notFound']()).toBe(true);
      expect(component['isDraftHidden']()).toBe(true);
    });

    it('renders the members-only state (not a 404) when access is denied', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'denied', denied_reason: 'not_member_company' }));

      fixture = TestBed.createComponent(NewsletterReaderComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      TestBed.tick();
      fixture.detectChanges();

      expect(component['membersOnly']()).toBe(true);
      expect(component['notFound']()).toBe(false);
      expect(fixture.nativeElement.querySelector('[data-testid="newsletter-reader-members-only"]')).not.toBeNull();
      expect(newsletterService.joinNewsletterGroup).not.toHaveBeenCalled();
    });

    it('does not join when the reader is already a group member', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));

      fixture = TestBed.createComponent(NewsletterReaderComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      TestBed.tick();

      expect(newsletterService.joinNewsletterGroup).not.toHaveBeenCalled();
      expect(component['joinState']().status).toBe('idle');
    });

    it('automatically joins an eligible reader exactly once and confirms', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of(eligibleAccess));
      vi.mocked(newsletterService.joinNewsletterGroup).mockReturnValue(
        of({ status: 'added', email: 'jane@acme-motors.example', committee_name: 'LF Weekly', company_name: 'Acme Motors' })
      );

      fixture = TestBed.createComponent(NewsletterReaderComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      TestBed.tick();
      fixture.detectChanges();

      expect(newsletterService.joinNewsletterGroup).toHaveBeenCalledTimes(1);
      expect(newsletterService.joinNewsletterGroup).toHaveBeenCalledWith('proj-123', 'news-123');
      expect(component['joinState']().status).toBe('added');
      expect(fixture.nativeElement.querySelector('[data-testid="newsletter-member-benefit-added"]')).not.toBeNull();
      expect(fixture.nativeElement.textContent).toContain('jane@acme-motors.example');
    });

    it('shows no banner when the join is refused because an admin is impersonating', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of(eligibleAccess));
      vi.mocked(newsletterService.joinNewsletterGroup).mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'not available', code: 'IMPERSONATION_READ_ONLY' } }))
      );

      fixture = TestBed.createComponent(NewsletterReaderComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      TestBed.tick();

      expect(component['joinState']().status).toBe('idle');
    });

    it('surfaces a failed join and retries on demand', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of(eligibleAccess));
      vi.mocked(newsletterService.joinNewsletterGroup)
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502 })))
        .mockReturnValueOnce(of({ status: 'already_member', email: '', committee_name: '', company_name: '' }));

      fixture = TestBed.createComponent(NewsletterReaderComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      TestBed.tick();

      expect(component['joinState']().status).toBe('failed');

      component['retryJoin']();
      TestBed.tick();

      expect(newsletterService.joinNewsletterGroup).toHaveBeenCalledTimes(2);
      expect(component['joinState']().status).toBe('already_member');
    });
  });

  describe('during SSR', () => {
    beforeEach(async () => {
      // The outer beforeEach already instantiated the module; rebuild it on the server platform,
      // reusing the same service mocks.
      const providers = [
        { provide: ProjectService, useValue: projectService },
        { provide: NewsletterService, useValue: newsletterService },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$ } },
        { provide: ShareDialogService, useValue: { open: vi.fn() } },
        { provide: LensService, useValue: { setLens: vi.fn().mockReturnValue(true) } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: PLATFORM_ID, useValue: 'server' },
      ];
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({ imports: [NewsletterReaderComponent], providers }).compileComponents();
    });

    it('never joins on the server, even for an eligible reader', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(
        of({
          access: 'eligible',
          newsletter: makeNewsletter(),
          qualifying_email: 'jane@acme-motors.example',
          company_name: 'Acme Motors',
          committee_name: 'LF Weekly',
        })
      );

      fixture = TestBed.createComponent(NewsletterReaderComponent);
      component = fixture.componentInstance;
      TestBed.tick();

      expect(component['access']()?.access).toBe('eligible');
      expect(newsletterService.joinNewsletterGroup).not.toHaveBeenCalled();
    });

    it('never records a page view on the server', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));

      fixture = TestBed.createComponent(NewsletterReaderComponent);
      component = fixture.componentInstance;
      TestBed.tick();

      expect(component['newsletter']()?.id).toBe('news-123');
      expect(newsletterService.recordPageView).not.toHaveBeenCalled();
    });
  });

  describe('invite a colleague', () => {
    // Restore even when an assertion throws mid-test, so fake timers never leak into later tests.
    afterEach(() => vi.useRealTimers());

    function render(): HTMLElement {
      fixture = TestBed.createComponent(NewsletterReaderComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      TestBed.tick();
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    it('shows the CTA when the issue foundation allows inviting and opens the invite dialog with it', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));
      vi.mocked(newsletterService.getMyNewsletterFoundations).mockReturnValue(of(makeFoundationsResponse()));

      const el = render();
      el.querySelector<HTMLButtonElement>('[data-testid="newsletter-reader-invite"] button')!.click();

      expect(dialogService.open).toHaveBeenCalledWith(
        NewsletterInviteDialogComponent,
        expect.objectContaining({ header: 'Invite a colleague', data: { foundation: expect.objectContaining({ uid: 'proj-123' }) } })
      );
    });

    it('resolves a sub-project issue to its foundation through the feed row', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject({ uid: 'sub-1', parent_uid: 'other-parent' })));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter({ project_uid: 'sub-1' }) }));
      vi.mocked(newsletterService.getMyNewsletterFoundations).mockReturnValue(
        of(
          makeFoundationsResponse({
            foundations: [makeFoundation({ uid: 'found-1' })],
            newsletters: [{ id: 'news-123', project_uid: 'sub-1', foundation_uid: 'found-1' } as MyNewsletterFoundationsResponse['newsletters'][number]],
          })
        )
      );

      render();

      expect(component['issueFoundation']()?.uid).toBe('found-1');
    });

    it("links the breadcrumb's middle crumb to the parent foundation's newsletter list for a sub-project issue (#4979)", () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject({ uid: 'sub-1', name: 'Sub Project', parent_uid: 'found-1' })));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter({ project_uid: 'sub-1' }) }));
      vi.mocked(newsletterService.getMyNewsletterFoundations).mockReturnValue(
        of(
          makeFoundationsResponse({
            foundations: [makeFoundation({ uid: 'found-1', slug: 'tlf', name: 'The Linux Foundation' })],
            newsletters: [{ id: 'news-123', project_uid: 'sub-1', foundation_uid: 'found-1' } as MyNewsletterFoundationsResponse['newsletters'][number]],
          })
        )
      );

      const el = render();
      const crumb = el.querySelector<HTMLAnchorElement>('[data-testid="newsletter-reader-foundation-link"]')!;
      expect(el.querySelector('[data-testid="newsletter-reader-breadcrumb"]')?.getAttribute('aria-label')).toBe('Breadcrumb');
      expect(crumb.textContent?.trim()).toBe('The Linux Foundation');
      expect(crumb.getAttribute('href')).toBe('/newsletters/my/tlf');

      const router = TestBed.inject(Router);
      const lensService = TestBed.inject(LensService);
      crumb.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }));
      expect(lensService.setLens).toHaveBeenCalledWith('me');
      expect(router.navigate).toHaveBeenCalledWith(['/newsletters/my', 'tlf']);
    });

    it('falls back to the project name linking to the foundation cards when the foundation does not resolve', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject({ uid: 'sub-1', name: 'Sub Project', parent_uid: 'other-parent' })));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'auditor', newsletter: makeNewsletter({ project_uid: 'sub-1' }) }));
      vi.mocked(newsletterService.getMyNewsletterFoundations).mockReturnValue(
        of(makeFoundationsResponse({ foundations: [makeFoundation({ uid: 'other-parent' })] }))
      );

      const el = render();
      const crumb = el.querySelector<HTMLAnchorElement>('[data-testid="newsletter-reader-foundation-link"]')!;
      expect(crumb.textContent?.trim()).toBe('Sub Project');
      expect(crumb.getAttribute('href')).toBe('/newsletters/my');

      const router = TestBed.inject(Router);
      crumb.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }));
      expect(router.navigate).toHaveBeenCalledWith(['/newsletters/my']);
    });

    it('resolves through another feed row of the same project when the issue is not in the feed', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject({ uid: 'sub-1', parent_uid: 'found-1' })));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'auditor', newsletter: makeNewsletter({ project_uid: 'sub-1' }) }));
      vi.mocked(newsletterService.getMyNewsletterFoundations).mockReturnValue(
        of(
          makeFoundationsResponse({
            foundations: [makeFoundation({ uid: 'found-1' })],
            newsletters: [{ id: 'news-older', project_uid: 'sub-1', foundation_uid: 'found-1' } as MyNewsletterFoundationsResponse['newsletters'][number]],
          })
        )
      );

      render();

      expect(component['issueFoundation']()?.uid).toBe('found-1');
    });

    it('never guesses the parent card when the server has not grouped the project under it', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject({ uid: 'sub-1', parent_uid: 'other-parent' })));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'auditor', newsletter: makeNewsletter({ project_uid: 'sub-1' }) }));
      vi.mocked(newsletterService.getMyNewsletterFoundations).mockReturnValue(
        of(makeFoundationsResponse({ foundations: [makeFoundation({ uid: 'other-parent' })] }))
      );

      const el = render();

      expect(component['issueFoundation']()).toBeNull();
      expect(el.querySelector('[data-testid="newsletter-reader-invite"]')).toBeNull();
    });

    it('hides the CTA when the foundation does not allow inviting', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));
      vi.mocked(newsletterService.getMyNewsletterFoundations).mockReturnValue(
        of(makeFoundationsResponse({ foundations: [makeFoundation({ can_invite: false, invite_denied_reason: 'not_member_company' })] }))
      );

      expect(render().querySelector('[data-testid="newsletter-reader-invite"]')).toBeNull();
    });

    it('hides the CTA when the issue foundation is not among the reader foundations', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));
      vi.mocked(newsletterService.getMyNewsletterFoundations).mockReturnValue(
        of(makeFoundationsResponse({ foundations: [makeFoundation({ uid: 'unrelated' })] }))
      );

      expect(render().querySelector('[data-testid="newsletter-reader-invite"]')).toBeNull();
    });

    it('hides the CTA when the lookup fails', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));
      vi.mocked(newsletterService.getMyNewsletterFoundations).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })));

      expect(render().querySelector('[data-testid="newsletter-reader-invite"]')).toBeNull();
    });

    it('does not look up invite eligibility for a denied reader', () => {
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'denied', denied_reason: 'not_member_company' }));

      render();

      expect(newsletterService.getMyNewsletterFoundations).not.toHaveBeenCalled();
    });

    it('also re-checks after a retried join reports the reader is already on the list', () => {
      vi.useFakeTimers();
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(
        of({
          access: 'eligible',
          newsletter: makeNewsletter(),
          qualifying_email: 'jane@acme-motors.example',
          company_name: 'Acme Motors',
          committee_name: 'LF Weekly',
        })
      );
      vi.mocked(newsletterService.joinNewsletterGroup)
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502 })))
        .mockReturnValueOnce(of({ status: 'already_member', email: '', committee_name: 'LF Weekly', company_name: '' }));
      vi.mocked(newsletterService.getMyNewsletterFoundations)
        .mockReturnValueOnce(of(makeFoundationsResponse({ foundations: [] })))
        .mockReturnValue(of(makeFoundationsResponse()));

      const el = render();
      expect(component['joinState']().status).toBe('failed');

      component['retryJoin']();
      TestBed.tick();
      vi.advanceTimersByTime(NEWSLETTER_INVITE_RELOOKUP_DELAY_MS);
      TestBed.tick();
      fixture.detectChanges();

      expect(component['joinState']().status).toBe('already_member');
      expect(newsletterService.getMyNewsletterFoundations).toHaveBeenCalledTimes(2);
      expect(el.querySelector('[data-testid="newsletter-reader-invite"]')).not.toBeNull();
    });

    it('looks up again, after the index delay, once the member benefit adds the reader to the group', () => {
      vi.useFakeTimers();
      vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
      vi.mocked(newsletterService.getReaderAccess).mockReturnValue(
        of({
          access: 'eligible',
          newsletter: makeNewsletter(),
          qualifying_email: 'jane@acme-motors.example',
          company_name: 'Acme Motors',
          committee_name: 'LF Weekly',
        })
      );
      const join$ = new Subject<NewsletterJoinResult>();
      vi.mocked(newsletterService.joinNewsletterGroup).mockReturnValue(join$);
      vi.mocked(newsletterService.getMyNewsletterFoundations)
        .mockReturnValueOnce(of(makeFoundationsResponse({ foundations: [] })))
        .mockReturnValue(of(makeFoundationsResponse()));

      const el = render();
      expect(component['joinState']().status).toBe('joining');
      expect(newsletterService.getMyNewsletterFoundations).toHaveBeenCalledTimes(1);
      expect(el.querySelector('[data-testid="newsletter-reader-invite"]')).toBeNull();

      join$.next({ status: 'added', email: 'jane@acme-motors.example', committee_name: 'LF Weekly', company_name: 'Acme Motors' });
      TestBed.tick();
      fixture.detectChanges();

      expect(component['joinState']().status).toBe('added');
      // Not straight away: the query-service index has not picked up the new membership yet.
      expect(newsletterService.getMyNewsletterFoundations).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(NEWSLETTER_INVITE_RELOOKUP_DELAY_MS);
      TestBed.tick();
      fixture.detectChanges();

      expect(newsletterService.getMyNewsletterFoundations).toHaveBeenCalledTimes(2);
      expect(el.querySelector('[data-testid="newsletter-reader-invite"]')).not.toBeNull();
    });
  });
});
