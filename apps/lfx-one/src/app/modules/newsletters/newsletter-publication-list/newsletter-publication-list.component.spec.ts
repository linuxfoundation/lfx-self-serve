// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { NewsletterPublication } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { NEVER, of, throwError } from 'rxjs';
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
  // Identifiable rather than `{}`: `{}` can't distinguish "relativeTo the
  // component's own route" from "relativeTo something else" — any object
  // (including `undefined`) satisfies `expect.anything()` except `undefined`
  // itself, which is exactly the value a wrong relativeTo source would
  // produce. Asserting the exact reference pins the anchor, not just its
  // presence.
  const routeStub = { __id: 'newsletter-publication-list-route' };

  async function setup(uid = 'proj-1') {
    activeContextUid = signal(uid);
    await TestBed.configureTestingModule({
      imports: [NewsletterPublicationListComponent],
      providers: [
        { provide: NewsletterService, useValue: { listAllPublications: vi.fn() } },
        { provide: ProjectContextService, useValue: { activeContextUid } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ActivatedRoute, useValue: routeStub },
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

    expect(router.navigate).toHaveBeenCalledWith(['owning-proj', 'pub-42', 'editions'], { relativeTo: routeStub });
  });

  it('routes the empty-state create CTA to the edition composer', async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(of({ publications: [] }));
    await create();

    component['goToCreate']();

    expect(router.navigate).toHaveBeenCalledWith(['create'], { relativeTo: routeStub });
  });

  it("routes the 'All newsletters' link to the flat list, relative to its own route", async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(of({ publications: [] }));
    await create();

    fixture.nativeElement.querySelector('[data-testid="newsletter-publication-list-all-link"]').click();

    expect(router.navigate).toHaveBeenCalledWith(['list'], { relativeTo: routeStub });
  });

  it('renders the empty state with its title, subtitle, and create CTA when there are no publications', async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(of({ publications: [] }));
    await create();

    const emptyState = fixture.nativeElement.querySelector('[data-testid="newsletter-publication-list-empty-state"]');
    expect(emptyState).toBeTruthy();
    const cardText = fixture.nativeElement.querySelector('[data-testid="newsletter-publication-list-card"]').textContent;
    expect(cardText).toContain('No publications yet');
    expect(cardText).toContain('Create a publication to start organizing your newsletters.');
    expect(cardText).toContain('Create newsletter');
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="newsletter-publication-row-"]').length).toBe(0);
  });

  it('renders one row per publication, with the default badge only on the default publication', async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(
      of({ publications: [makePublication({ id: 'pub-1', is_default: true }), makePublication({ id: 'pub-2', name: 'Release Notes', is_default: false })] })
    );
    await create();

    const rows = fixture.nativeElement.querySelectorAll('[data-testid^="newsletter-publication-row-"]');
    expect(rows.length).toBe(2);
    expect(fixture.nativeElement.querySelector('[data-testid="publication-default-badge-pub-1"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="publication-default-badge-pub-2"]')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('[data-testid="newsletter-publication-list-empty-state"]')).toBeFalsy();
  });

  it('shows loading skeletons while the request is pending, hiding the empty state and rows', async () => {
    // NEVER, not of(...): toObservable registers a root effect that Angular
    // flushes within the same detectChanges() pass, before the template
    // renders — an observable that completes synchronously (like of(...))
    // would already have set loading(false) by the time this test's
    // assertions run, same trap the signal-level "starts in the loading
    // state" test above avoids by never calling detectChanges() at all. A
    // held-open source is the only way to deterministically pin the pending
    // state under detectChanges() rather than depending on flush ordering.
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(NEVER);

    fixture = TestBed.createComponent(NewsletterPublicationListComponent);
    fixture.detectChanges();
    // NEVER never settles, so whenStable() resolves immediately here (nothing
    // pending registers) — this still follows the repo's zoneless convention
    // of awaiting stability rather than trusting a bare detectChanges(), per
    // docs/architecture/testing/unit-testing.md, and matches this file's own
    // create() helper below.
    await fixture.whenStable();

    // Pins "pending", not just "loading defaults to true": without this, the
    // assertions below would pass identically even if listAllPublications
    // were never called at all.
    expect(newsletterService.listAllPublications).toHaveBeenCalledWith('proj-1');
    expect(fixture.nativeElement.querySelectorAll('p-skeleton').length).toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelector('[data-testid="newsletter-publication-list-empty-state"]')).toBeFalsy();
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="newsletter-publication-row-"]').length).toBe(0);
  });
});
