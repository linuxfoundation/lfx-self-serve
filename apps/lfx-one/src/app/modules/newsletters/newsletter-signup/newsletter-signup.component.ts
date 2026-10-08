// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser, isPlatformServer } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  makeStateKey,
  PLATFORM_ID,
  signal,
  Signal,
  TransferState,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { PublicNewsletterSignupPageState } from '@lfx-one/shared/interfaces';
import { isValidEmail } from '@lfx-one/shared/utils';
import { NewsletterService } from '@services/newsletter.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, finalize, map, of, startWith, switchMap, tap } from 'rxjs';

/**
 * Public, anonymous signup page for one Newsletter group (`/projects/:projectSlug/newsletter-signup/:groupUid`).
 * The visitor only enters an email; the BFF resolves the LF account and adds them to the group.
 */
@Component({
  selector: 'lfx-newsletter-signup',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent, SkeletonModule],
  templateUrl: './newsletter-signup.component.html',
})
export class NewsletterSignupComponent {
  // === Services ===
  private readonly route = inject(ActivatedRoute);
  private readonly newsletterService = inject(NewsletterService);
  private readonly transferState = inject(TransferState);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

  // === View Children ===
  private readonly successHeading = viewChild<ElementRef<HTMLElement>>('successHeading');

  // === Forms ===
  protected readonly form = new FormGroup({
    email: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
  });

  // === Writable Signals ===
  protected readonly submitting = signal(false);
  protected readonly subscribedEmail = signal<string | null>(null);
  protected readonly emailError = signal<string | null>(null);
  protected readonly submitError = signal<string | null>(null);

  // Persists the SSR-resolved page so the client's first paint matches the server DOM (same pattern
  // as `PublicProjectGroupsComponent`).
  private readonly stateKey = makeStateKey<PublicNewsletterSignupPageState>('newsletterSignupState');
  private readonly state: Signal<PublicNewsletterSignupPageState> = this.initState();

  // === Computed Signals ===
  protected readonly loading = computed(() => this.state().loading);
  protected readonly notFound = computed(() => this.state().notFound);
  protected readonly info = computed(() => this.state().info);
  protected readonly projectInitials: Signal<string> = this.initProjectInitials();

  public constructor() {
    // Browser-only: focus the email field for mouse/trackpad visitors so they can type straight away.
    // Skipped on touch devices, where an autofocus pops the keyboard over the project context.
    afterNextRender(() => {
      if (this.info() && this.document.defaultView?.matchMedia('(pointer: fine)').matches) {
        this.focusEmailInput();
      }
    });

    // Typing after an error clears it — the visitor is already fixing it.
    this.form.controls.email.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.emailError.set(null);
      this.submitError.set(null);
    });
  }

  // === Protected Methods ===
  protected onEmailBlur(): void {
    const value = this.form.controls.email.value.trim();
    // Don't nag on an empty field the visitor merely tabbed through.
    if (value && !isValidEmail(value)) {
      this.emailError.set('Enter a valid email address, like name@example.com.');
    }
  }

  protected onSubmit(): void {
    const info = this.info();
    if (!info || this.submitting()) {
      return;
    }

    const email = this.form.controls.email.value.trim().toLowerCase();
    if (!email) {
      this.emailError.set('Enter your email address to subscribe.');
      return;
    }
    if (!isValidEmail(email)) {
      this.emailError.set('Enter a valid email address, like name@example.com.');
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);
    this.newsletterService
      .subscribeToNewsletter(info.project.slug, info.group.uid, email)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => {
          this.subscribedEmail.set(email);
          this.focusSuccessHeading();
        },
        error: (error: HttpErrorResponse) => this.handleSubmitError(error),
      });
  }

  protected subscribeAnother(): void {
    this.subscribedEmail.set(null);
    this.form.reset();
    afterNextRender(() => this.focusEmailInput(), { injector: this.injector });
  }

  // === Private Initializers ===
  private initState(): Signal<PublicNewsletterSignupPageState> {
    const initial: PublicNewsletterSignupPageState = { loading: true, notFound: false, error: false, info: null };
    const transferred = this.transferState.get(this.stateKey, null);
    // Consume the SSR state once so a later instance for a different link can't paint stale details.
    if (isPlatformBrowser(this.platformId) && transferred) {
      this.transferState.remove(this.stateKey);
    }

    return toSignal(
      this.route.paramMap.pipe(
        map((params) => ({ projectSlug: params.get('projectSlug') ?? '', groupUid: params.get('groupUid') ?? '' })),
        distinctUntilChanged((a, b) => a.projectSlug === b.projectSlug && a.groupUid === b.groupUid),
        switchMap(({ projectSlug, groupUid }, index) =>
          this.newsletterService.getPublicSignupInfo(projectSlug, groupUid).pipe(
            map((info): PublicNewsletterSignupPageState => ({ loading: false, notFound: false, error: false, info })),
            catchError((error: HttpErrorResponse) => {
              // A 404 is an expected outcome (invalid or repointed link); anything else is a real failure.
              if (error.status !== 404) {
                console.error('Failed to load newsletter signup page', error);
              }
              return of<PublicNewsletterSignupPageState>({ loading: false, notFound: error.status === 404, error: error.status !== 404, info: null });
            }),
            tap((state) => {
              if (isPlatformServer(this.platformId) && !state.loading) {
                this.transferState.set(this.stateKey, state);
              }
            }),
            startWith(index === 0 && transferred ? transferred : initial)
          )
        )
      ),
      { initialValue: transferred ?? initial }
    );
  }

  private initProjectInitials(): Signal<string> {
    return computed(() => {
      const name = this.info()?.project.name ?? '';
      const words = name.split(/\s+/).filter(Boolean);
      return words
        .slice(0, 2)
        .map((word) => word[0].toUpperCase())
        .join('');
    });
  }

  // === Private Helpers ===
  private handleSubmitError(error: HttpErrorResponse): void {
    if (error.status === 429) {
      this.submitError.set('Too many attempts. Please wait a minute and try again.');
    } else if (error.status === 400 && this.validationField(error) === 'email') {
      this.emailError.set('Enter a valid email address, like name@example.com.');
    } else if (error.status === 400 && this.validationField(error) === 'group') {
      this.submitError.set("This newsletter isn't accepting signups right now. Please contact the project.");
    } else if (error.status === 404) {
      this.submitError.set('This signup link is no longer valid. Please contact the project for an updated link.');
    } else {
      this.submitError.set('Something went wrong and you were not subscribed. Please try again.');
    }
  }

  /** Field named by the BFF's own `ServiceValidationError` body; any other 400 (e.g. upstream) has none. */
  private validationField(error: HttpErrorResponse): string | undefined {
    const errors: unknown = error.error?.errors;
    return Array.isArray(errors) ? errors[0]?.field : undefined;
  }

  private focusEmailInput(): void {
    this.document.getElementById('newsletter-signup-email')?.focus();
  }

  private focusSuccessHeading(): void {
    // Move focus to the confirmation so keyboard and screen-reader users land on the outcome.
    afterNextRender(() => this.successHeading()?.nativeElement.focus(), { injector: this.injector });
  }
}
