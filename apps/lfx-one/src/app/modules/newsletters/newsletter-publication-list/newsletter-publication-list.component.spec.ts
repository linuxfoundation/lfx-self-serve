// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { NewsletterPublication } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
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
  let dialogService: DialogService;
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
        // createPublication itself is now called by CreatePublicationDialogComponent,
        // not this component — see its own spec — so it's not stubbed here.
        { provide: NewsletterService, useValue: { listAllPublications: vi.fn() } },
        { provide: ProjectContextService, useValue: { activeContextUid } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ActivatedRoute, useValue: routeStub },
      ],
    })
      // The component declares its own `providers: [DialogService]` (needed
      // in the real app so each list instance gets its own dialog stack) —
      // that component-level provider is resolved by the node injector
      // *before* this TestBed module's injector, so it silently shadows the
      // mock above: without this override, the component was opening a
      // real PrimeNG DialogService/Dialog the whole time, and every
      // assertion against the `dialogService` mock below was checking a spy
      // the component never actually called.
      .overrideComponent(NewsletterPublicationListComponent, { remove: { providers: [DialogService] } })
      .compileComponents();

    newsletterService = TestBed.inject(NewsletterService);
    messageService = TestBed.inject(MessageService);
    dialogService = TestBed.inject(DialogService);
    router = TestBed.inject(Router);
  }

  // Stubs DialogService.open to return a ref whose onClose emits `result`
  // once, matching DynamicDialogRef's real contract closely enough for this
  // component's usage (it only ever reads onClose, never anything else on
  // the ref). The dialog itself now owns the actual createPublication call
  // (see CreatePublicationDialogComponent's own spec) — onClose closes with
  // the created NewsletterPublication directly, not a request payload.
  function stubDialogClosingWith(result: NewsletterPublication | null | undefined): void {
    vi.mocked(dialogService.open).mockReturnValue({ onClose: of(result) } as unknown as DynamicDialogRef);
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

  it('surfaces a load failure via the message service, clears loading, and marks loadFailed', async () => {
    await setup('proj-1');
    // { error: '...' }, not { message: '...' } — the BFF's error envelope
    // (BaseApiError.toResponse) keys the upstream reason as `error`.
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { error: 'boom' } })));

    await create();

    expect(messageService.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Could not load publications', detail: 'boom' }));
    expect(component['loading']()).toBe(false);
    expect(component['publications']()).toEqual([]);
    expect(component['loadFailed']()).toBe(true);
  });

  it('retryLoad() re-runs the load against the current project and clears loadFailed on success', async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    await create();
    expect(component['loadFailed']()).toBe(true);

    vi.mocked(newsletterService.listAllPublications).mockReturnValueOnce(of({ publications: [makePublication()] }));
    component['retryLoad']();
    await fixture.whenStable();

    expect(newsletterService.listAllPublications).toHaveBeenCalledTimes(2);
    expect(component['loadFailed']()).toBe(false);
    expect(component['publications']()).toEqual([makePublication()]);
  });

  it('does not hide an already-populated list behind the error state when a background retry fails', async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValueOnce(of({ publications: [makePublication()] }));
    await create();

    vi.mocked(newsletterService.listAllPublications).mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    component['retryLoad']();
    await fixture.whenStable();

    // The toast still reports the failure (see the message-service test
    // above for that assertion in isolation) — but with real, still-valid
    // rows on screen, flipping to the dedicated error empty-state would
    // hide them behind a "couldn't load" message that isn't true anymore.
    expect(component['loadFailed']()).toBe(false);
    expect(component['publications']()).toEqual([makePublication()]);
  });

  it('shows the skeleton again when Retry is clicked from the error state (there is nothing worth preserving on screen)', async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    await create();
    expect(component['loading']()).toBe(false);

    // Left unresolved so the intermediate state (right after retryLoad(),
    // before the new result lands) is actually observable — the bug this
    // guards against is Retry leaving `loading` false and the error panel
    // sitting there with no feedback at all.
    vi.mocked(newsletterService.listAllPublications).mockReturnValueOnce(NEVER);
    component['retryLoad']();

    expect(component['loading']()).toBe(true);
  });

  it('shows the error state with a Retry action instead of the create empty-state after a failed load', async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    await create();

    expect(fixture.nativeElement.querySelector('[data-testid="newsletter-publication-list-error-state"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="newsletter-publication-list-empty-state"]')).toBeFalsy();
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

  it("opens the create-publication dialog with the current project, and lands on the created publication's editions on success", async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(of({ publications: [] }));
    const created = makePublication({ id: 'new-pub', project_uid: 'proj-1', name: 'Weekly Digest', slug: 'weekly-digest' });
    stubDialogClosingWith(created);
    await create();

    component['openCreatePublicationDialog']();

    expect(dialogService.open).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ header: 'Create Publication', data: { projectUid: 'proj-1' } })
    );
    // Lands on the new publication's editions — same navigation
    // goToPublicationEditions itself performs, proving this reuses it rather
    // than duplicating (and potentially drifting from) that navigation logic.
    expect(router.navigate).toHaveBeenCalledWith(['proj-1', 'new-pub', 'editions'], { relativeTo: routeStub });
  });

  it('does not navigate, but does re-list, when the dialog is dismissed via X/Escape (closes with undefined)', async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(of({ publications: [] }));
    // undefined, not null: PrimeNG's own X/Escape/backdrop close affordances
    // close with no argument, distinct from the dialog's own cancel(), which
    // closes with `null` (see the next test).
    stubDialogClosingWith(undefined);
    await create();

    component['openCreatePublicationDialog']();
    await fixture.whenStable();

    expect(router.navigate).not.toHaveBeenCalled();
    // retryLoad() re-fetches defensively — a create request could have been
    // in flight when the dialog was dismissed this way (see
    // openCreatePublicationDialog's own doc comment on that race).
    expect(newsletterService.listAllPublications).toHaveBeenCalledTimes(2);
  });

  it('does not re-list on an explicit Cancel (closes with null) — a create can never be in flight on that path', async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(of({ publications: [] }));
    stubDialogClosingWith(null);
    await create();

    component['openCreatePublicationDialog']();
    await fixture.whenStable();

    expect(router.navigate).not.toHaveBeenCalled();
    // Only the initial load — cancel() closes with `null` only when it can
    // prove nothing reached upstream (it checks `attemptFailed` and
    // `submitting()` itself, not just the template's own [disabled] binding
    // on its Cancel button — see cancel()'s own doc comment), so there is
    // nothing a re-list could surface here.
    expect(newsletterService.listAllPublications).toHaveBeenCalledTimes(1);
  });

  it('re-lists on a dismissal without clearing the currently-rendered list or re-flashing the skeleton', async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValueOnce(of({ publications: [makePublication()] }));
    stubDialogClosingWith(undefined);
    await create();
    expect(component['publications']()).toEqual([makePublication()]);

    // A second, still-unresolved call for the retry triggered by the
    // dismissal: if the retry path clears `publications`/`loading`
    // synchronously (the bug this test guards against), that would already
    // be visible below before this observable ever emits.
    vi.mocked(newsletterService.listAllPublications).mockReturnValueOnce(NEVER);
    component['openCreatePublicationDialog']();
    await fixture.whenStable();

    expect(component['publications']()).toEqual([makePublication()]);
    expect(component['loading']()).toBe(false);
  });

  it('does not open the dialog, but does explain why, when there is no active project', async () => {
    await setup('');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(of({ publications: [] }));
    await create();

    component['openCreatePublicationDialog']();

    expect(dialogService.open).not.toHaveBeenCalled();
    // The empty-state CTA is reachable in this same state (an empty
    // projectUid renders the create empty-state, not an error state) — a
    // silent no-op click would be a dead-click regression from the
    // unconditional navigation this replaced.
    expect(messageService.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
  });

  it("clicking the header 'New publication' button opens the create dialog", async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(of({ publications: [makePublication()] }));
    stubDialogClosingWith(undefined);
    await create();

    // `[data-testid="..."] button`, not a click on the lfx-button host
    // element directly: ButtonComponent has no host click listener, only the
    // inner p-button's native <button> actually fires (click) — a click on
    // the wrapper itself wouldn't reach openCreatePublicationDialog() at all.
    fixture.nativeElement.querySelector('[data-testid="newsletter-publication-list-new-button"] button').click();

    expect(dialogService.open).toHaveBeenCalled();
  });

  it("hides the header 'New publication' button when there are no publications yet (the empty state owns the only CTA)", async () => {
    await setup('proj-1');
    vi.mocked(newsletterService.listAllPublications).mockReturnValue(of({ publications: [] }));
    await create();

    expect(fixture.nativeElement.querySelector('[data-testid="newsletter-publication-list-new-button"]')).toBeFalsy();
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
    expect(cardText).toContain('Create publication');
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
