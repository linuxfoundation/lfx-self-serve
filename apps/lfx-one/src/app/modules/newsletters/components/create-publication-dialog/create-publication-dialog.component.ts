// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { NEWSLETTER_PUBLICATION_MAX_NAME_LENGTH, NEWSLETTER_PUBLICATION_MAX_SLUG_LENGTH } from '@lfx-one/shared/constants';
import { CreatePublicationDialogData, NewsletterPublication } from '@lfx-one/shared/interfaces';
import { slugify, truncateSlug } from '@lfx-one/shared/utils';
import { maxCodePointsValidator, trimmedRequired } from '@lfx-one/shared/validators';
import { NewsletterService } from '@services/newsletter.service';
import { extractStructuredErrorMessage } from '@shared/utils/http-error.utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { finalize, take } from 'rxjs';

/**
 * Collects just a name and derives the slug from it via the shared
 * `slugify()`. Not purely a client-side convenience: upstream enforces
 * `^[a-z0-9]+(-[a-z0-9]+)*$` and a 100-character max on `slug` (newsletter-
 * service's publication service), and `slugify()`'s output always satisfies
 * the pattern (runs of non-alphanumerics collapse to one hyphen, leading/
 * trailing hyphens trimmed) — but NOT the length bound: `slugify` runs NFKD
 * normalization to strip diacritics (so accented Latin names still produce a
 * real slug), and NFKD is a *compatibility* decomposition that can expand a
 * character rather than just shed a combining mark (e.g. the single-codepoint
 * ligature 'ﬁ' becomes 'f' + 'i'; fraction and Roman-numeral compatibility
 * characters expand similarly), so a name well within
 * `maxCodePointsValidator(NEWSLETTER_PUBLICATION_MAX_NAME_LENGTH)` built from
 * enough of those can still derive a slug over upstream's 100-char cap. A
 * name in a script with no Latin decomposition (CJK, Cyrillic, etc.) or made
 * entirely of symbols collapses to '' instead — generateFallbackSlug covers
 * that rather than blocking creation on it, and is itself built to stay
 * inside the same upstream pattern (see its own doc comment). `create()`
 * below truncates the derived slug to upstream's 100-char max directly,
 * rather than trusting the name-length validator as a proxy for it.
 *
 * Owns the `createPublication` call itself, rather than handing the
 * collected name back to the caller to submit: on failure — most likely a
 * slug collision, since upstream enforces `UNIQUE (project_uid, slug)` — the
 * dialog stays open with the typed name intact and shows the error inline,
 * so the user can adjust the name and retry without retyping it from
 * scratch.
 *
 * Closes with three distinct signals the caller (see
 * NewsletterPublicationListComponent.openCreatePublicationDialog) reads
 * apart: the created `NewsletterPublication` on success; `null` on an
 * explicit Cancel that followed no failed attempt and isn't racing one still
 * in flight — `cancel()` checks both itself (`this.attemptFailed ||
 * this.submitting()`) rather than trusting the template's own
 * [disabled]="submitting()" on the Cancel button to make the in-flight case
 * unreachable, since the `null` signal's correctness — the caller skips its
 * defensive re-list because of it — must not rest on that binding staying
 * intact; `undefined` otherwise — a mid-flight dismissal (the dialog's
 * `X`/Escape, `takeUntilDestroyed` below unsubscribing and aborting the
 * request client-side without guaranteeing upstream never received it), a
 * Cancel that followed a failed attempt, or a Cancel invoked while a request
 * is still in flight (both carry the same ambiguity: the create may already
 * have been committed upstream). The caller re-lists on an undefined close
 * specifically to surface a publication that landed anyway.
 */
@Component({
  selector: 'lfx-create-publication-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent],
  templateUrl: './create-publication-dialog.component.html',
})
export class CreatePublicationDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<CreatePublicationDialogData>);
  private readonly newsletterService = inject(NewsletterService);
  private readonly destroyRef = inject(DestroyRef);

  // Exposed so the template's error message can read the same number
  // instead of a hard-coded copy of it.
  protected readonly maxNameLength = NEWSLETTER_PUBLICATION_MAX_NAME_LENGTH;

  public readonly form = new FormGroup({
    // trimmedRequired, not (or in addition to) Validators.required: the
    // latter only checks length === 0, so a whitespace-only name would pass
    // it, trim() to '' in create(), and 400 upstream on a name the user
    // never actually typed. maxCodePointsValidator, not Validators.maxLength:
    // the latter counts UTF-16 code units, so a name built from astral-plane
    // characters (emoji, some CJK extension characters) would be rejected at
    // roughly half of maxNameLength — maxCodePointsValidator counts actual
    // Unicode code points, matching what a user perceives as "characters".
    // This is a UI-only display-width guard, not a proxy for the slug's cap
    // — upstream enforces no length limit on name at all;
    // NEWSLETTER_PUBLICATION_MAX_SLUG_LENGTH bounds the slug independently
    // in create() below, regardless of name length.
    name: new FormControl('', { nonNullable: true, validators: [trimmedRequired(), maxCodePointsValidator(this.maxNameLength)] }),
  });
  // Template-facing handle so `nameControl.errors`/`.touched` reads in the
  // template are property reads, not `form.get('name')` method calls
  // re-executed on every change-detection pass.
  protected readonly nameControl = this.form.controls.name;
  public readonly submitting = signal(false);
  public readonly submitError = signal<string | null>(null);
  // Whether a create attempt has failed since this dialog opened. Cancel's
  // `null` signal is only trustworthy — "nothing could have reached
  // upstream" — when this is still false; a failed attempt carries the same
  // ambiguity a mid-flight dismissal does (see cancel()'s own comment).
  private attemptFailed = false;

  public constructor() {
    // The dialog stays open with the name intact specifically so the user
    // can edit it in place after a failure — but the failure message names
    // the *rejected* value, so it needs to disappear once that value has
    // actually changed, rather than sitting there (now describing nothing
    // the field currently holds) until the next Create click re-evaluates it.
    this.nameControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.submitError.set(null));
  }

  public cancel(): void {
    // undefined whenever the "nothing could have reached upstream" claim
    // isn't provable in code — a failed attempt, or a request still in
    // flight. The template's [disabled]="submitting()" on the Cancel button
    // should already make the latter unreachable, but the `null` signal's
    // correctness (the caller skips its defensive re-list because of it)
    // must not rest on that binding staying intact — the same reason
    // create() re-guards itself against a template change that drops its
    // own [disabled] binding, just on the path where losing the guard would
    // actually strand a publication instead of merely double-submitting.
    // See openCreatePublicationDialog's own doc comment for what the caller
    // does with each signal.
    this.ref.close(this.attemptFailed || this.submitting() ? undefined : null);
  }

  public create(): void {
    if (this.form.invalid || this.submitting()) {
      // Unreachable via the template (the Create button is disabled while
      // invalid or already submitting), kept as a defensive guard against a
      // future template change that removes either binding.
      return;
    }
    const projectUid = this.config.data?.projectUid;
    if (!projectUid) {
      // Unreachable in practice — the only caller always passes data (see
      // NewsletterPublicationListComponent.openCreatePublicationDialog) —
      // but reading it before touching `submitting` means a future caller
      // that forgets to pass it fails inline instead of leaving the dialog
      // stuck mid-submit (a throw between `submitting.set(true)` and the
      // `finalize` that clears it would never clear it).
      this.submitError.set('Could not create publication. Please try again.');
      return;
    }
    const name = this.nameControl.value.trim();
    const derivedSlug = slugify(name);
    // Truncate rather than trust the name's own maxLength as a proxy for the
    // slug's: NFKD normalization inside slugify() can expand certain
    // characters (see this class's own doc comment), so a name at the limit
    // can still derive a slug over it.
    const slug = derivedSlug ? truncateSlug(derivedSlug, NEWSLETTER_PUBLICATION_MAX_SLUG_LENGTH) : generateFallbackSlug();

    this.submitError.set(null);
    this.submitting.set(true);
    // Locks the field for the same duration the two buttons are already
    // locked for ([disabled]="submitting()") — without this, an edit made
    // while the request is in flight wouldn't change what this attempt is
    // actually about (`name` above is already captured), but a 409 handled
    // below would still narrate the *stale* value, back in the field
    // reading something the error message no longer describes.
    // FormControlName syncs this straight onto the native input's disabled
    // attribute (via _onDisabledChange, unconditional regardless of
    // emitEvent), so no template change is needed.
    //
    // { emitEvent: false } on both this call and its re-enable below is
    // load-bearing, not cosmetic: disable()/enable() emit on valueChanges by
    // default, and the constructor's own valueChanges subscription clears
    // submitError on any emission — without emitEvent: false, re-enabling
    // here would immediately wipe out the error the failure handler below
    // just set, on every single failure. A genuine user edit still clears
    // it normally, since setValue() (not disable/enable) is what emits then.
    this.nameControl.disable({ emitEvent: false });
    this.newsletterService
      // The block composer is this branch's own editor; classic is only
      // upstream's zero-value default for a field this dialog doesn't expose.
      .createPublication(projectUid, { name, slug, editor_type: 'blocks' })
      .pipe(
        take(1),
        finalize(() => {
          this.submitting.set(false);
          this.nameControl.enable({ emitEvent: false });
        }),
        // A mid-flight dismissal (X/Escape) unsubscribes here, which aborts
        // the underlying request — without this, `next`/`error` would still
        // run on a destroyed component and call `ref.close()` a second time
        // on an already-closed ref. Aborting doesn't guarantee the create
        // never reached upstream (see openCreatePublicationDialog's own doc
        // comment on the parent's defensive re-list for that race).
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (publication: NewsletterPublication) => this.ref.close(publication),
        error: (err: HttpErrorResponse) => {
          console.error('Failed to create publication', err);
          // Marks this attempt as one that could have reached upstream
          // despite the error surfacing here — see attemptFailed's own field
          // comment and cancel()'s use of it.
          this.attemptFailed = true;
          // Left open, name intact, per this component's own doc comment —
          // the most likely cause is the UNIQUE (project_uid, slug)
          // constraint (a duplicate name), which is directly fixable by
          // editing the name without losing what was already typed.
          //
          // The 409 is special-cased rather than shown verbatim: upstream's
          // conflict message is built around the *slug* ("a publication with
          // slug \"weekly-digest\" already exists..."), a value this dialog
          // derives silently and never shows — next to a form whose only
          // field is Name, that message names a concept and a value the user
          // never typed and can't map onto anything on screen.
          //
          // The substitute deliberately says "a name like" rather than
          // asserting a publication named exactly `name` exists: slugify()
          // is many-to-one ("Weekly Digest" and "Weekly-Digest" collide), so
          // claiming an exact-name match would be a statement the visible
          // list can directly contradict, and "try a different name" alone
          // could send the user through several slug-equivalent variants
          // ("Weekly Digest!", "weekly digest") that all 409 again for the
          // same underlying reason.
          //
          // Anything else falls through to extractStructuredErrorMessage,
          // not extractErrorMessage: the latter's fallback is
          // `error.message`, which for an HttpErrorResponse is always
          // Angular's populated "Http failure response for ..." string — so
          // a body-less failure (a network drop, a gateway 502/504, a
          // non-JSON error page) would still leak that raw string into this
          // dialog instead of the friendly fallback below.
          this.submitError.set(
            err.status === 409
              ? `A publication with a name like "${name}" already exists in this project. Try a more distinct name.`
              : (extractStructuredErrorMessage(err) ?? 'Could not create publication. Please try again.')
          );
        },
      });
  }
}

/**
 * A short slug for a name slugify() couldn't derive one from (a script with
 * no Latin decomposition, or symbols/whitespace only). Not derived from the
 * name at all — there's nothing usable left of it once slugify() has emptied
 * it out — so this is deliberately opaque rather than trying to approximate
 * the name. The name itself is never lost: it's still what's stored and
 * displayed; the slug is purely a URL-safe identifier.
 *
 * `Math.floor(Math.random() * 36 ** 8)` then zero-padded to a fixed 8 base-36
 * digits, not `Math.random().toString(36).slice(2, 8)`: the latter can
 * legitimately produce fewer than 8 characters (a low-order draw needs fewer
 * base-36 digits to represent), including the degenerate all-zero case
 * ("publication-" with nothing after the hyphen) — which fails upstream's
 * `^[a-z0-9]+(-[a-z0-9]+)*$` slug pattern (a trailing hyphen with no
 * following alphanumeric run) and 400s. Fixed-width, zero-padded output is
 * always exactly 8 `[a-z0-9]` characters, so the result always satisfies
 * that pattern regardless of the draw.
 *
 * Known asymmetry: because this slug is random rather than derived, the
 * `UNIQUE (project_uid, slug)` collision that gives a Latin-name duplicate
 * its 409 (see the class doc comment) essentially never fires for a name
 * that reaches this fallback — every attempt draws a fresh slug, so the
 * same CJK/Cyrillic/symbols-only name can be created repeatedly with no
 * warning. Not closed here: doing so needs a name-uniqueness check against
 * the caller's already-loaded publication list (or a dedicated upstream
 * check), which is out of scope for this fallback's own job of keeping
 * creation from being blocked outright.
 */
function generateFallbackSlug(): string {
  const suffix = Math.floor(Math.random() * 36 ** 8)
    .toString(36)
    .padStart(8, '0');
  return `publication-${suffix}`;
}
