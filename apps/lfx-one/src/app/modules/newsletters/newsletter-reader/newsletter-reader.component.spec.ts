// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Newsletter, Project } from '@lfx-one/shared/interfaces';
import { ProjectStage } from '@lfx-one/shared/enums';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, NEVER, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

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
      getReaderAccess: vi.fn(),
      joinNewsletterGroup: vi.fn(),
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
        provideNoopAnimations(),
      ],
    }).compileComponents();

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

  it('should have copyLink method bound to clipboard service', () => {
    vi.mocked(projectService.getProjectStrict).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getReaderAccess).mockReturnValue(of({ access: 'group_member', newsletter: makeNewsletter() }));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    expect(component['copyLink']).toBeDefined();
    expect(typeof component['copyLink']).toBe('function');
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
        { provide: ClipboardShareService, useValue: { copyLink: vi.fn() } },
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
  });
});
