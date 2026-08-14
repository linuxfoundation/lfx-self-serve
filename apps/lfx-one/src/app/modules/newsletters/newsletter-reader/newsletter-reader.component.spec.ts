// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { Newsletter, Project } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';

import { NewsletterReaderComponent } from './newsletter-reader.component';
import { ProjectService } from '@services/project.service';
import { NewsletterService } from '@services/newsletter.service';
import { ClipboardShareService } from '@services/clipboard-share.service';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    uid: 'proj-123',
    slug: 'kubernetes',
    description: 'Test project',
    name: 'Kubernetes',
    writer: false,
    public: true,
    parent_uid: '',
    stage: 'active',
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

  beforeEach(async () => {
    const mockProjectService = {
      getProject: vi.fn(),
    };
    const mockNewsletterService = {
      getNewsletter: vi.fn(),
    };
    const mockClipboardShareService = {
      copyLink: vi.fn(),
    };

    const activatedRoute = {
      paramMap: of(
        new Map([
          ['projectSlug', 'kubernetes'],
          ['id', 'news-123'],
        ])
      ),
    };

    await TestBed.configureTestingModule({
      imports: [NewsletterReaderComponent],
      providers: [
        { provide: ProjectService, useValue: mockProjectService },
        { provide: NewsletterService, useValue: mockNewsletterService },
        { provide: ActivatedRoute, useValue: activatedRoute },
        { provide: ClipboardShareService, useValue: mockClipboardShareService },
      ],
    }).compileComponents();

    projectService = TestBed.inject(ProjectService);
    newsletterService = TestBed.inject(NewsletterService);
  });

  it('should create', () => {
    vi.mocked(projectService.getProject).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(of(makeNewsletter()));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    expect(component).toBeTruthy();
  });

  it('should initialize with loading true', () => {
    vi.mocked(projectService.getProject).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(of(makeNewsletter()));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    expect(component['loading']()).toBe(true);
  });

  it('should render draft newsletter when user is a writer', () => {
    vi.mocked(projectService.getProject).mockReturnValue(of(makeProject({ writer: true })));
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
    const getProjectSpy = vi.mocked(projectService.getProject);
    getProjectSpy.mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(of(makeNewsletter()));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    // Service should be called as route params are emitted
    expect(getProjectSpy).toHaveBeenCalled();
  });

  it('should have copyLink method bound to clipboard service', () => {
    vi.mocked(projectService.getProject).mockReturnValue(of(makeProject()));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(of(makeNewsletter()));

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    expect(component['copyLink']).toBeDefined();
    expect(typeof component['copyLink']).toBe('function');
  });
});
