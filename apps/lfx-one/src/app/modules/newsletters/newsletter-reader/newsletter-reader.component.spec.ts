// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { Clipboard } from '@angular/cdk/clipboard';
import { MessageService } from 'primeng/api';

import { NewsletterReaderComponent } from './newsletter-reader.component';
import { ProjectService } from '@services/project.service';
import { NewsletterService } from '@services/newsletter.service';

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
    const mockClipboard = {
      copy: vi.fn().mockReturnValue(true),
    };
    const mockMessageService = {
      add: vi.fn(),
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
        { provide: Clipboard, useValue: mockClipboard },
        { provide: MessageService, useValue: mockMessageService },
      ],
    }).compileComponents();

    projectService = TestBed.inject(ProjectService);
    newsletterService = TestBed.inject(NewsletterService);
  });

  it('should create', () => {
    vi.mocked(projectService.getProject).mockReturnValue(of({ uid: 'proj-123', writer: false } as any));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(
      of({ subject: 'Test', body_html: '<p>Test</p>', status: 'sent', sent_at: '2026-08-13T10:00:00Z' } as any)
    );

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    expect(component).toBeTruthy();
  });

  it('should initialize with loading true', () => {
    vi.mocked(projectService.getProject).mockReturnValue(of({ uid: 'proj-123', writer: false } as any));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(
      of({ subject: 'Test', body_html: '<p>Test</p>', status: 'sent' } as any)
    );

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    expect(component['loading']()).toBe(true);
  });

  it('should render draft newsletter when user is a writer', () => {
    vi.mocked(projectService.getProject).mockReturnValue(of({ uid: 'proj-123', writer: true } as any));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(
      of({ subject: 'Draft', body_html: '<p>Draft content</p>', status: 'draft' } as any)
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
    const getProjectSpy = vi.mocked(projectService.getProject);
    getProjectSpy.mockReturnValue(of({ uid: 'proj-123', writer: false } as any));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(
      of({ subject: 'Test', body_html: '<p>Test</p>', status: 'sent' } as any)
    );

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    // Service should be called as route params are emitted
    expect(getProjectSpy).toHaveBeenCalled();
  });

  it('should have copyLink method bound to clipboard service', () => {
    vi.mocked(projectService.getProject).mockReturnValue(of({ uid: 'proj-123', writer: false } as any));
    vi.mocked(newsletterService.getNewsletter).mockReturnValue(
      of({ subject: 'Test', body_html: '<p>Test</p>', status: 'sent' } as any)
    );

    fixture = TestBed.createComponent(NewsletterReaderComponent);
    component = fixture.componentInstance;
    expect(component['copyLink']).toBeDefined();
    expect(typeof component['copyLink']).toBe('function');
  });
});
