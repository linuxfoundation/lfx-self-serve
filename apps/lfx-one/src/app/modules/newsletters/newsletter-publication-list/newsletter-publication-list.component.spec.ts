// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { NewsletterPublication } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { NewsletterPublicationListComponent } from './newsletter-publication-list.component';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';

function makePublication(overrides: Partial<NewsletterPublication> = {}): NewsletterPublication {
  return {
    id: 'pub-1',
    project_uid: 'proj-1',
    name: 'Weekly Digest',
    slug: 'weekly-digest',
    is_default: false,
    ...overrides,
  } as NewsletterPublication;
}

describe('NewsletterPublicationListComponent', () => {
  let fixture: ComponentFixture<NewsletterPublicationListComponent>;
  let component: NewsletterPublicationListComponent;
  let newsletterService: NewsletterService;
  let messageService: MessageService;
  let router: Router;
  let activeContextUid: WritableSignal<string>;

  async function setup(uid = 'proj-1') {
    activeContextUid = signal(uid);
    await TestBed.configureTestingModule({
      imports: [NewsletterPublicationListComponent],
      providers: [
        { provide: NewsletterService, useValue: { listAllPublications: vi.fn() } },
        { provide: ProjectContextService, useValue: { activeContextUid } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ActivatedRoute, useValue: {} },
      ],
    }).compileComponents();

    newsletterService = TestBed.inject(NewsletterService);
    messageService = TestBed.inject(MessageService);
    router = TestBed.inject(Router);
  }

  async function create() {
    fixture = TestBed.createComponent(NewsletterPublicationListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('starts in the loading state so the skeletons show before the first emission (no empty-state flash)', async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(of({ publications: [] }));

    // Create without flushing the async context emission.
    fixture = TestBed.createComponent(NewsletterPublicationListComponent);
    component = fixture.componentInstance;

    expect(component['loading']()).toBe(true);
    expect(component['hasPublications']()).toBe(false);
  });

  it('loads publications for the active project context', async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(of({ publications: [makePublication()] }));

    await create();

    expect(newsletterService.listAllPublications).toHaveBeenCalledWith('proj-1');
    expect(component['publications']()).toEqual([makePublication()]);
    expect(component['loading']()).toBe(false);
    expect(component['hasPublications']()).toBe(true);
  });

  it('does not call the service when there is no active context', async () => {
    await setup('');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(of({ publications: [makePublication()] }));

    await create();

    expect(newsletterService.listAllPublications).not.toHaveBeenCalled();
    expect(component['publications']()).toEqual([]);
    expect(component['loading']()).toBe(false);
    expect(component['hasPublications']()).toBe(false);
  });

  it('surfaces a load failure via the message service and clears loading', async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'boom' } })));

    await create();

    expect(messageService.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Could not load publications', detail: 'boom' }));
    expect(component['loading']()).toBe(false);
    expect(component['publications']()).toEqual([]);
  });

  it("navigates to a publication's editions, carrying the publication's own project_uid alongside the publication id", async () => {
    // Active context deliberately differs from the publication's own project_uid:
    // the navigation must use the latter, not fall back to ambient context.
    await setup('active-proj');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(of({ publications: [] }));
    await create();

    component['goToPublicationEditions'](makePublication({ id: 'pub-42', project_uid: 'owning-proj' }));

    expect(router.navigate).toHaveBeenCalledWith(['owning-proj', 'pub-42', 'editions'], expect.objectContaining({ relativeTo: expect.anything() }));
  });

  it('routes the empty-state create CTA to the edition composer', async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(of({ publications: [] }));
    await create();

    component['goToCreate']();

    expect(router.navigate).toHaveBeenCalledWith(['create'], expect.objectContaining({ relativeTo: expect.anything() }));
  });
});
