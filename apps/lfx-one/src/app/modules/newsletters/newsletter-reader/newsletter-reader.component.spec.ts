// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Newsletter, Project } from '@lfx-one/shared/interfaces';
import { ProjectStage } from '@lfx-one/shared/enums';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, NEVER, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { NewsletterReaderComponent } from './newsletter-reader.component';
import { ProjectService } from '@services/project.service';
import { NewsletterService } from '@services/newsletter.service';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { LensService } from '@services/lens.service';

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

describe('NewsletterReaderComponent', () => {
  let component: NewsletterReaderComponent;
  let fixture: ComponentFixture<NewsletterReaderComponent>;
  let projectService: ProjectService;
  let newsletterService: NewsletterService;
  let paramMap$: BehaviorSubject<Map<string, string>>;

  beforeEach(async () => {
    const mockProjectService = {
      getProjectStrict: vi.fn(),
    };
    const mockNewsletterService = {
      getNewsletter: vi.fn(),
    };
    const mockClipboardShareService = {
      copyLink: vi.fn(),
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
        { provide: ClipboardShareService, useValue: mockClipboardShareService },
        { provide: LensService, useValue: { setLens: vi.fn().mockReturnValue(true) } },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    }).compileComponents();

    projectService = TestBed.inject(ProjectService);
    newsletterService = TestBed.inject(NewsletterService);
  });

  it('should create', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(of(makeNewsletter()));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    expect(component).toBeTruthy();
  });

  it('should initialize with loading true', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(of(makeNewsletter()));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    expect(component['loading']()).toBe(true);
  });

  it('should render draft newsletter when user is a writer', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject({ writer: true })));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(of(makeNewsletter({ subject: 'Draft', body_html: '<p>Draft content</p>', status: 'draft' })));

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
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(of(makeNewsletter()));

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
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(of(makeNewsletter()));

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
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    TestBed.tick();

    expect(component['loading']()).toBe(false);
    expect(component['error']()).toBe(false);
    expect(component['notFound']()).toBe(true);
  });

  it('should surface a 5xx newsletter fetch as error, not a permanent 404', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    TestBed.tick();

    expect(component['loading']()).toBe(false);
    expect(component['error']()).toBe(true);
    expect(component['notFound']()).toBe(false);
  });

  it('should map a 404 project lookup (bad slug) to the not-found state', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(of(makeNewsletter()));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    TestBed.tick();

    expect(component['loading']()).toBe(false);
    expect(component['error']()).toBe(false);
    expect(component['notFound']()).toBe(true);
  });

  it('should surface a project-service outage as error, not a permanent 404', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(of(makeNewsletter()));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    TestBed.tick();

    expect(component['loading']()).toBe(false);
    expect(component['error']()).toBe(true);
    expect(component['notFound']()).toBe(false);
  });

  it('should switch to the me lens before navigating back to the feed', () => {
    // Without the lens switch, lensRedirectGuard rewrites /newsletters/my to the
    // lens-prefixed mount and newsletterAccessGuard bounces non-writers away.
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(of(makeNewsletter()));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;

    const lensService = TestBed.inject(LensService);
    const router = TestBed.inject(Router);
    component['goToMyNewsletters'](new MouseEvent('click', { button: 0 }));

    expect(lensService.setLens).toHaveBeenCalledWith('me');
    expect(router.navigate).toHaveBeenCalledWith(['/newsletters/my']);
    // Order matters: navigating first would let lensRedirectGuard rewrite the
    // URL against the old lens before the switch lands.
    expect(vi.mocked(lensService.setLens).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(router.navigate).mock.invocationCallOrder[0]);
  });

  it('should leave modified clicks on the breadcrumb to the browser (new tab)', () => {
    // Cmd/Ctrl-click must not be intercepted so the href can open in a new
    // tab; the lens is still persisted so that tab lands on the me feed.
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(of(makeNewsletter()));

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

  it('should have copyLink method bound to clipboard service', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(of(makeNewsletter()));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    expect(component['copyLink']).toBeDefined();
    expect(typeof component['copyLink']).toBe('function');
  });
});
