// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NewsletterPublication } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CreatePublicationDialogComponent } from './create-publication-dialog.component';
import { NewsletterService } from '@services/newsletter.service';

function makePublication(overrides: Partial<NewsletterPublication> = {}): NewsletterPublication {
  return {
    id: 'pub-1',
    project_uid: 'proj-1',
    name: 'Weekly Digest',
    slug: 'weekly-digest',
    is_default: false,
    wrapper_content: null,
    editor_type: 'blocks',
    created_by: 'test-user',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

describe('CreatePublicationDialogComponent', () => {
  let fixture: ComponentFixture<CreatePublicationDialogComponent>;
  let component: CreatePublicationDialogComponent;
  let ref: DynamicDialogRef;
  let newsletterService: NewsletterService;

  async function create() {
    await TestBed.configureTestingModule({
      imports: [CreatePublicationDialogComponent],
      providers: [
        // ButtonComponent's template binds [routerLink] unconditionally
        // (even when unset), so its RouterLink directive always attaches
        // and injects ActivatedRoute — needed even though this dialog's
        // two <lfx-button>s never actually navigate.
        provideRouter([]),
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data: { projectUid: 'proj-1' } } },
        { provide: NewsletterService, useValue: { createPublication: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CreatePublicationDialogComponent);
    component = fixture.componentInstance;
    ref = TestBed.inject(DynamicDialogRef);
    newsletterService = TestBed.inject(NewsletterService);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  // Belt-and-suspenders for the Math.random spy below: if a test throws
  // before reaching its own restore, this still prevents the pin from
  // leaking into every later test in the file.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('closes with null on an explicit cancel, distinguishing it from a dismissal', async () => {
    await create();

    component.cancel();

    // Read by the caller (NewsletterPublicationListComponent) to skip its
    // defensive re-list — safe only because this Cancel followed no failed
    // attempt (see the next test for when it isn't).
    expect(ref.close).toHaveBeenCalledWith(null);
  });

  it('closes with undefined (not null) on cancel after a failed create attempt', async () => {
    await create();
    vi.mocked(newsletterService.createPublication).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: null })));

    component.form.controls.name.setValue('Weekly Digest');
    component.create();
    expect(component.submitError()).toBeTruthy();

    component.cancel();

    // A failed attempt (this one: no structured body, the kind a gateway
    // 502 or a network drop produces) may still have been committed
    // upstream before the error surfaced — the same ambiguity a mid-flight
    // dismissal carries — so this must NOT be the "nothing could have
    // happened" null signal.
    expect(ref.close).toHaveBeenCalledWith(undefined);
  });

  it('closes with undefined, not null, if cancel is somehow invoked while a request is still in flight', async () => {
    await create();
    vi.mocked(newsletterService.createPublication).mockReturnValue(NEVER);

    // The template's [disabled]="submitting()" on the Cancel button should
    // make this unreachable in practice — this pins that cancel() doesn't
    // rely on that binding to keep its own "nothing could have reached
    // upstream" claim true, the same way create() re-guards itself against
    // its own [disabled] binding being dropped.
    component.form.controls.name.setValue('Weekly Digest');
    component.create();
    expect(component.submitting()).toBe(true);

    component.cancel();

    expect(ref.close).toHaveBeenCalledWith(undefined);
  });

  it('derives the slug from the name, creates it against the dialog-config project, and closes with the created publication', async () => {
    await create();
    const created = makePublication({ name: 'Weekly Digest', slug: 'weekly-digest' });
    vi.mocked(newsletterService.createPublication).mockReturnValue(of(created));

    component.form.controls.name.setValue('Weekly Digest');
    component.create();

    expect(newsletterService.createPublication).toHaveBeenCalledWith('proj-1', { name: 'Weekly Digest', slug: 'weekly-digest', editor_type: 'blocks' });
    expect(ref.close).toHaveBeenCalledWith(created);
  });

  it('trims the name before deriving the slug and submitting', async () => {
    await create();
    vi.mocked(newsletterService.createPublication).mockReturnValue(of(makePublication()));

    component.form.controls.name.setValue('  Release Notes  ');
    component.create();

    expect(newsletterService.createPublication).toHaveBeenCalledWith('proj-1', expect.objectContaining({ name: 'Release Notes', slug: 'release-notes' }));
  });

  it('does not submit (or close) when the form is invalid', async () => {
    await create();

    component.form.controls.name.setValue('');
    component.create();

    expect(newsletterService.createPublication).not.toHaveBeenCalled();
    expect(ref.close).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only name as invalid, unlike plain Validators.required', async () => {
    await create();

    // Validators.required alone would pass this (length > 0) and let it
    // through to trim() → '' → a 400 upstream the user never sees explained
    // — trimmedRequired is what catches it inline instead.
    component.form.controls.name.setValue('   ');
    component.create();

    expect(component.form.invalid).toBe(true);
    expect(newsletterService.createPublication).not.toHaveBeenCalled();
  });

  it('marks the form invalid past the name-length limit', async () => {
    await create();

    component.form.controls.name.setValue('a'.repeat(component['maxNameLength'] + 1));

    expect(component.form.invalid).toBe(true);
    await fixture.whenStable();
    // Also pins the template's error key actually matching what the
    // validator emits — a drift here (e.g. back to the pre-fix 'maxlength',
    // which maxCodePointsValidator never sets) would disable Create with no
    // on-screen explanation, exactly the failure mode noted in the
    // template's own comment.
    expect(fixture.nativeElement.textContent).toContain('characters or fewer');
  });

  it('counts code points, not UTF-16 units, so an astral-plane name at the limit is still valid', async () => {
    await create();

    // 😀 (U+1F600) is a single code point but two UTF-16 code units —
    // Validators.maxLength (what this validator replaced) would have
    // rejected this name at roughly half of maxNameLength.
    component.form.controls.name.setValue('😀'.repeat(component['maxNameLength']));

    expect(component.form.invalid).toBe(false);
  });

  it('accepts a name over 100 characters (the slug cap), unlike upstream which enforces no name length limit at all', async () => {
    await create();
    vi.mocked(newsletterService.createPublication).mockReturnValue(of(makePublication()));

    // The name's own limit (maxNameLength) is a UI-only display-width guard
    // decoupled from NEWSLETTER_PUBLICATION_MAX_SLUG_LENGTH — this name is
    // over the slug's 100-char cap but still well under maxNameLength, so it
    // must submit rather than be blocked by a limit that was never upstream's.
    component.form.controls.name.setValue('a'.repeat(150));
    component.create();

    expect(component.form.invalid).toBe(false);
    expect(newsletterService.createPublication).toHaveBeenCalledWith('proj-1', expect.objectContaining({ name: 'a'.repeat(150) }));
  });

  it('truncates a derived slug that exceeds 100 characters, rather than trusting the name-length validator as a proxy for it', async () => {
    await create();
    vi.mocked(newsletterService.createPublication).mockReturnValue(of(makePublication()));

    // 'ﬁ' is a single code point (60 of them here, well under
    // maxCodePointsValidator's 200-code-point name limit) but NFKD-decomposes
    // to 'f' + 'i', so slugify() alone would derive a 120-char slug — over
    // upstream's 100-char slug max despite the name itself being well within
    // its own, unrelated bound.
    component.form.controls.name.setValue('ﬁ'.repeat(60));
    component.create();

    expect(newsletterService.createPublication).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ slug: expect.stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/) })
    );
    const [, request] = vi.mocked(newsletterService.createPublication).mock.calls[0];
    expect(request.slug.length).toBeLessThanOrEqual(100);
  });

  it('falls back to a generated slug (rather than blocking) for a name that slugifies to empty', async () => {
    await create();
    vi.mocked(newsletterService.createPublication).mockReturnValue(of(makePublication()));

    // "---" passes trimmedRequired (non-blank after trimming) but slugify()
    // collapses it to '' — the exact case the fallback exists for, so this
    // still submits instead of erroring.
    component.form.controls.name.setValue('---');
    component.create();

    expect(newsletterService.createPublication).toHaveBeenCalledWith(
      'proj-1',
      // Fixed-width 8-char suffix, not just "one or more" — pins the
      // zero-padding that keeps the slug non-degenerate on every draw,
      // including Math.random() === 0 (see generateFallbackSlug's own doc
      // comment for why a variable-width suffix would fail this).
      expect.objectContaining({ name: '---', slug: expect.stringMatching(/^publication-[a-z0-9]{8}$/) })
    );
  });

  it('never produces a trailing-hyphen slug even on the lowest possible random draw', async () => {
    // Math.random() === 0 is the exact degenerate case a variable-width
    // fallback (e.g. .toString(36).slice(2, 8), which can legitimately
    // produce '' for a low-order draw) would fail on: "publication-" with
    // nothing after the hyphen breaks upstream's
    // ^[a-z0-9]+(-[a-z0-9]+)*$ slug pattern.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await create();
    vi.mocked(newsletterService.createPublication).mockReturnValue(of(makePublication()));

    component.form.controls.name.setValue('---');
    component.create();

    expect(newsletterService.createPublication).toHaveBeenCalledWith('proj-1', expect.objectContaining({ slug: 'publication-00000000' }));
    // Restored by the file's afterEach — not inline here, so an assertion
    // failure above still leaves Math.random pinned for exactly one file
    // (this one), not silently unrestored for the rest of the suite.
  });

  it('stays open with the typed name intact on a create failure', async () => {
    await create();
    vi.mocked(newsletterService.createPublication).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    component.form.controls.name.setValue('Weekly Digest');
    component.create();

    expect(ref.close).not.toHaveBeenCalled();
    expect(component.form.controls.name.value).toBe('Weekly Digest');
    expect(component.submitError()).toBeTruthy();
    expect(component.submitting()).toBe(false);

    // Specifically past a real change-detection tick, not just the
    // synchronous assertion above: this is the regression class where
    // nameControl.enable() (in finalize, re-enabling the field this failure
    // just locked) emitted on valueChanges with no options and the
    // constructor's own valueChanges subscription cleared submitError right
    // back out — a bug the synchronous assertion above already happens to
    // catch too, but this pins it at the point a future async change to
    // this pipeline would be most likely to first surface it.
    await fixture.whenStable();
    expect(component.submitError()).toBeTruthy();
  });

  it("shows a name-based message on a 409, not upstream's slug-based conflict text verbatim", async () => {
    await create();
    // Upstream's real conflict message names the *slug*
    // ('a publication with slug "weekly-digest" already exists...') — shown
    // verbatim next to a form whose only field is Name, that names a value
    // the user never typed and can't map onto anything on screen. { error:
    // '...' } is the BFF envelope shape; this specifically must NOT reach
    // the label — the 409 branch is special-cased ahead of it.
    vi.mocked(newsletterService.createPublication).mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'a publication with slug "weekly-digest" already exists in this project' } }))
    );

    component.form.controls.name.setValue('Weekly Digest');
    component.create();

    // "a name like", not "named" — slugify() is many-to-one (see
    // string.utils.spec.ts's "Alpha Project"/"Alpha-Project" collision test),
    // so asserting an exact-name match would be a claim the visible list
    // could directly contradict.
    expect(component.submitError()).toBe('A publication with a name like "Weekly Digest" already exists in this project. Try a more distinct name.');
  });

  it('reads a structured error message for a non-409 failure', async () => {
    await create();
    vi.mocked(newsletterService.createPublication).mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, error: { error: 'internal error' } }))
    );

    component.form.controls.name.setValue('Weekly Digest');
    component.create();

    expect(component.submitError()).toBe('internal error');
  });

  it('clears the inline error as soon as the name is edited, rather than leaving a stale message describing a value no longer in the field', async () => {
    await create();
    vi.mocked(newsletterService.createPublication).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));

    component.form.controls.name.setValue('Weekly Digest');
    component.create();
    expect(component.submitError()).toBeTruthy();

    component.form.controls.name.setValue('Weekly Digest 2');

    expect(component.submitError()).toBeNull();
  });

  it("shows the friendly fallback, not Angular's raw HTTP failure string, for a body-less failure", async () => {
    await create();
    // No structured body at all — a network drop, a gateway 502/504, or a
    // non-JSON error page all land here. HttpErrorResponse.message is always
    // populated by Angular regardless ("Http failure response for ..."),
    // which is exactly the string this dialog must not surface as if it
    // were an actionable, upstream-provided reason.
    vi.mocked(newsletterService.createPublication).mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));

    component.form.controls.name.setValue('Weekly Digest');
    component.create();

    expect(component.submitError()).toBe('Could not create publication. Please try again.');
  });

  it('guards against a second submit while a request is already in flight', async () => {
    await create();
    vi.mocked(newsletterService.createPublication).mockReturnValue(NEVER);

    component.form.controls.name.setValue('Weekly Digest');
    component.create();

    expect(component.submitting()).toBe(true);
    // A second click while in flight must not fire a second request — the
    // guard in create() (not just the template's [disabled] binding) is what
    // this pins.
    component.create();
    expect(newsletterService.createPublication).toHaveBeenCalledTimes(1);
  });

  it('disables both actions and the name field while a request is in flight, and re-enables them once it settles', async () => {
    await create();
    const response$ = new Subject<NewsletterPublication>();
    vi.mocked(newsletterService.createPublication).mockReturnValue(response$);

    component.form.controls.name.setValue('Weekly Digest');
    component.create();
    await fixture.whenStable();

    const cancelButton = () => fixture.nativeElement.querySelector('[data-testid="create-publication-cancel"] button');
    const submitButton = () => fixture.nativeElement.querySelector('[data-testid="create-publication-submit"] button');
    expect(cancelButton().disabled, 'Cancel should be disabled while in flight').toBe(true);
    expect(submitButton().disabled, 'Create should be disabled while in flight').toBe(true);
    // Not just the buttons: an edit made while this request is in flight
    // can't change what it's actually about (the name is already captured
    // in create()'s closure), so a 409 handled once it settles would narrate
    // a value the field no longer holds if editing were still possible.
    expect(component['nameControl'].disabled, 'Name should be disabled while in flight').toBe(true);

    response$.next(makePublication());
    response$.complete();
    await fixture.whenStable();

    expect(cancelButton().disabled, 'Cancel should re-enable once the request settles').toBe(false);
    expect(component['nameControl'].disabled, 'Name should re-enable once the request settles').toBe(false);
  });

  it('renders the name input and both actions', async () => {
    await create();

    expect(fixture.nativeElement.querySelector('[data-testid="create-publication-name-input"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="create-publication-submit"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="create-publication-cancel"]')).toBeTruthy();
  });

  it('disables the Create button while the name is empty', async () => {
    await create();

    const submitButton = fixture.nativeElement.querySelector('[data-testid="create-publication-submit"] button');
    expect(submitButton.disabled).toBe(true);
  });
});
