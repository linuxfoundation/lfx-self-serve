// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, effect, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { NEWSLETTER_COMMITTEE_CATEGORY, NEWSLETTER_STEP_TITLES, NEWSLETTER_TOTAL_STEPS } from '@lfx-one/shared/constants';
import {
  Committee,
  CreateNewsletterRequest,
  GenerateNewsletterResponse,
  Newsletter,
  NewsletterManageViewMode,
  NewsletterSendResult,
  ProjectContext,
  UpdateNewsletterRequest,
} from '@lfx-one/shared/interfaces';
import { formatRelativeTime, stripHtml } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { StepperModule } from 'primeng/stepper';
import {
  catchError,
  combineLatest,
  concatMap,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  map,
  of,
  Subject,
  switchMap,
  take,
  tap,
} from 'rxjs';

import { NewsletterAudienceStepComponent } from '../components/newsletter-audience-step/newsletter-audience-step.component';
import { NewsletterContentStepComponent } from '../components/newsletter-content-step/newsletter-content-step.component';
import { NewsletterPreviewDrawerComponent } from '../components/newsletter-preview-drawer/newsletter-preview-drawer.component';
import { NewsletterReviewComponent } from '../components/newsletter-review/newsletter-review.component';
import { NewsletterSendStepComponent } from '../components/newsletter-send-step/newsletter-send-step.component';

@Component({
  selector: 'lfx-newsletter-manage',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    StepperModule,
    SkeletonModule,
    ConfirmDialogModule,
    ButtonComponent,
    NewsletterAudienceStepComponent,
    NewsletterContentStepComponent,
    NewsletterSendStepComponent,
    NewsletterPreviewDrawerComponent,
    NewsletterReviewComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './newsletter-manage.component.html',
  styleUrl: './newsletter-manage.component.scss',
})
export class NewsletterManageComponent {
  // === Services ===
  protected readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly newsletterService = inject(NewsletterService);
  private readonly committeeService = inject(CommitteeService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);

  // === Forms ===
  // Form control names stay camelCase (Angular convention). API payloads
  // are serialized to snake_case at the boundary in saveDraft / runSend.
  public readonly form = new FormGroup({
    committeeUids: new FormControl<string[]>([], { nonNullable: true }),
    subject: new FormControl<string>('', { nonNullable: true }),
    bodyHtml: new FormControl<string>('', { nonNullable: true }),
  });

  // === Mode + state ===
  public readonly newsletterId = signal<string | null>(null);
  public readonly version = signal<number>(0);
  public readonly isEditMode = computed(() => this.newsletterId() !== null);
  public readonly draftLoading = signal<boolean>(false);
  public readonly submitting = signal<boolean>(false);
  // True while a failed send's status refetch is in flight — keeps autosave
  // suppressed across the gap between finalize() resetting `submitting` and
  // handleSendError resolving the newsletter's real status.
  private readonly resolvingSend = signal<boolean>(false);
  public readonly testSending = signal<boolean>(false);
  public readonly savedAt = signal<Date | null>(null);
  public readonly savingDraft = signal<boolean>(false);
  public readonly manualSaving = signal<boolean>(false);
  public readonly deletingDraft = signal<boolean>(false);
  public readonly previewDrawerVisible = signal<boolean>(false);

  // === Step state ===
  private readonly internalStep = signal<number>(1);
  public readonly totalSteps = NEWSLETTER_TOTAL_STEPS;
  public readonly currentStep: Signal<number> = this.initCurrentStep();
  // Edit mode lands on the Review summary; create flow always uses the stepper.
  // Driven by the URL so refresh / deep links restore the right view (see initViewMode).
  public readonly viewMode: Signal<NewsletterManageViewMode> = this.initViewMode();
  public readonly showReview = computed(() => this.viewMode() === 'review');

  // === Project context ===
  public readonly activeContext: Signal<ProjectContext | null> = this.projectContextService.activeContext;
  // In edit mode the route carries the owning newsletter's project_uid; prefer
  // that over ambient context so an edit URL keeps working after a foundation/
  // project context switch. Create mode has no projectUid segment, so we fall
  // back to the active context.
  private readonly routeProjectUid: Signal<string | null> = toSignal(this.route.paramMap.pipe(map((p) => p.get('projectUid'))), { initialValue: null });
  public readonly projectUid: Signal<string> = computed(() => this.routeProjectUid() || this.projectContextService.activeContextUid());
  public readonly displayName: Signal<string> = computed(() => this.activeContext()?.name ?? '');
  private readonly fetchedLogoUrl = signal<string | undefined>(undefined);
  public readonly logoUrl: Signal<string | undefined> = computed(() => this.activeContext()?.logoUrl || this.fetchedLogoUrl());
  public readonly hasContext: Signal<boolean> = computed(() => this.projectUid().length > 0);

  // === Auth-derived ===
  public readonly edName: Signal<string> = computed(() => {
    const user = this.userService.user();
    return user?.name || user?.given_name || user?.nickname || 'Executive Director';
  });
  public readonly edEmail: Signal<string> = computed(() => this.userService.user()?.email ?? '');

  // === Form mirrors ===
  private readonly committeeUidsValue = signal<string[]>([]);
  private readonly subjectValue = signal<string>('');
  private readonly bodyValue = signal<string>('');

  // === Save dedup ===
  private readonly lastSavedSnapshot = signal<{ subject: string; bodyHtml: string; committeeUids: string[] } | null>(null);
  private readonly saveTrigger$ = new Subject<boolean>();

  // === Recipient summary ===
  protected readonly recipientCount = signal<number | null>(null);
  protected readonly recipientCountLoading = signal<boolean>(false);

  // === Newsletter-eligible committees ===
  // Fetched once here (not duplicated in the audience-step child) and passed down
  // via inputs, since the upstream endpoint fans out through fetchAllQueryResources.
  protected readonly committeesLoading = signal<boolean>(false);
  protected readonly committeesError = signal<string | null>(null);
  protected readonly committees: Signal<Committee[]> = this.initCommittees();

  // null means "not yet loaded, or the fetch failed" — pruning is skipped in both
  // cases so a transient error or in-flight load never wipes a valid selection.
  private readonly eligibleCommitteeUids: Signal<Set<string> | null> = computed(() => {
    if (this.committeesLoading() || this.committeesError()) return null;
    return new Set(
      this.committees()
        .filter((c) => c.category === NEWSLETTER_COMMITTEE_CATEGORY)
        .map((c) => c.uid)
    );
  });

  // === Validation gates ===
  public readonly subjectFilled = computed(() => (this.subjectValue() ?? '').trim().length > 0);
  public readonly bodyFilled = computed(() => stripHtml(this.bodyValue() ?? '').length > 0);
  public readonly audienceFilled = computed(() => (this.committeeUidsValue() ?? []).length > 0);
  // Gates Send on eligibility having actually resolved — while committees are
  // still loading (or the fetch failed), eligibleCommitteeUids() is null and
  // initAudienceNormalization() deliberately skips pruning, so a stale/legacy
  // non-Newsletter audience could otherwise be sent before it's ever checked.
  public readonly audienceNormalized = computed(() => this.eligibleCommitteeUids() !== null);
  public readonly canSend = computed(
    () =>
      this.audienceFilled() &&
      this.audienceNormalized() &&
      this.subjectFilled() &&
      this.bodyFilled() &&
      this.hasContext() &&
      !this.submitting() &&
      !this.resolvingSend() &&
      !this.savingDraft()
  );
  public readonly canSendTest = computed(
    () => this.subjectFilled() && this.bodyFilled() && this.hasContext() && this.edEmail().length > 0 && !this.testSending()
  );
  public readonly canProceed = computed(() => this.computeCanProceed(this.currentStep()));
  public readonly canGoPrevious = computed(() => this.currentStep() > 1);
  public readonly canGoNext = computed(() => this.currentStep() < this.totalSteps && this.canProceed());
  public readonly canSaveDraft = computed(
    () => this.hasContext() && this.audienceFilled() && this.subjectFilled() && this.bodyFilled() && this.edEmail().length > 0 && !this.savingDraft()
  );
  public readonly isLastStep = computed(() => this.currentStep() === this.totalSteps);
  public readonly currentStepTitle = computed(() => NEWSLETTER_STEP_TITLES[this.currentStep()] ?? '');
  protected readonly savedLabel = computed(() => {
    const at = this.savedAt();
    if (!at) return null;
    return `Saved ${formatRelativeTime(at)}`;
  });

  public constructor() {
    this.initContextLogo();
    this.initFormMirrors();
    this.initLoadDraft();
    this.initSaveChannel();
    this.initAutosave();
    this.initRecipientCount();
    this.initAudienceNormalization();
  }

  protected goToStep(step: number | undefined): void {
    if (step === undefined || step < 1 || step > this.totalSteps) return;
    if (step > this.currentStep()) {
      for (let i = this.currentStep(); i < step; i++) {
        if (!this.computeCanProceed(i)) return;
      }
    }
    if (this.isEditMode()) {
      this.router.navigate([], { relativeTo: this.route, queryParams: { step }, queryParamsHandling: 'merge', replaceUrl: true });
    } else {
      this.internalStep.set(step);
    }
  }

  protected nextStep(): void {
    if (this.canGoNext()) this.goToStep(this.currentStep() + 1);
  }

  protected previousStep(): void {
    if (this.canGoPrevious()) this.goToStep(this.currentStep() - 1);
  }

  // Enter the stepper at a specific step from the Review screen.
  protected enterStep(step: number): void {
    if (step < 1 || step > this.totalSteps) return;
    if (!this.isEditMode()) {
      this.internalStep.set(step);
      return;
    }
    // Drop ?view=review so the stepper takes over, and pin ?step=N for refresh stability.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { step, view: null },
      queryParamsHandling: 'merge',
    });
  }

  protected backToReview(): void {
    if (!this.isEditMode()) return;
    // Clear ?step so the review-mode default applies on refresh.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view: 'review', step: null },
      queryParamsHandling: 'merge',
    });
  }

  protected onDeleteDraft(): void {
    const id = this.newsletterId();
    if (!id || this.deletingDraft()) return;
    const subjectLabel = this.subjectValue().trim() || 'Untitled draft';
    this.confirmationService.confirm({
      key: 'newsletter-manage',
      header: 'Delete draft?',
      message: `Are you sure you want to delete "${subjectLabel}"? This action cannot be undone.`,
      icon: 'pi pi-trash',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.runDeleteDraft(id),
    });
  }

  protected onCancel(): void {
    this.goToList();
  }

  protected onSaveAsDraft(): void {
    if (!this.canSaveDraft()) return;
    this.manualSaving.set(true);
    this.saveTrigger$.next(true);
  }

  protected openPreviewDrawer(): void {
    this.previewDrawerVisible.set(true);
  }

  protected onGenerated(result: GenerateNewsletterResponse): void {
    this.form.patchValue({
      subject: result.subject ?? this.form.controls.subject.value,
      bodyHtml: result.bodyHtml,
    });
  }

  protected onSendTest(): void {
    if (!this.canSendTest()) return;
    this.testSending.set(true);
    this.newsletterService
      .testSend(this.projectUid(), {
        subject: this.form.controls.subject.value,
        body_html: this.form.controls.bodyHtml.value,
        to_email: this.edEmail(),
      })
      .pipe(
        take(1),
        finalize(() => this.testSending.set(false))
      )
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Test sent',
            detail: `A test newsletter was sent to ${this.edEmail()}.`,
          });
        },
        error: (err: HttpErrorResponse) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Test send failed',
            detail: err?.error?.message || err?.message || 'Could not send test email. Please try again.',
          });
        },
      });
  }

  protected onSend(): void {
    if (!this.canSend()) return;
    const count = this.recipientCount();
    const recipientLabel = count !== null && count > 0 ? `${count} ${count === 1 ? 'recipient' : 'recipients'}` : 'the selected groups';
    this.confirmationService.confirm({
      key: 'newsletter-manage',
      header: 'Send newsletter?',
      message: `This will send your newsletter to ${recipientLabel}. Once sent, it can't be undone.`,
      icon: 'pi pi-paper-plane',
      acceptLabel: 'Send now',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.runSend(),
    });
  }

  private goToList(tab?: 'draft' | 'sent'): void {
    this.router.navigate(['list'], {
      relativeTo: this.route.parent,
      queryParams: tab ? { tab } : undefined,
    });
  }

  private computeCanProceed(step: number): boolean {
    switch (step) {
      case 1:
        return this.audienceFilled();
      case 2:
        return this.subjectFilled() && this.bodyFilled();
      case 3:
        return this.canSend();
      default:
        return false;
    }
  }

  private initFormMirrors(): void {
    this.form.controls.committeeUids.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((v) => this.committeeUidsValue.set(v ?? []));
    this.form.controls.subject.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((v) => this.subjectValue.set(v ?? ''));
    this.form.controls.bodyHtml.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((v) => this.bodyValue.set(v ?? ''));
  }

  private initRecipientCount(): void {
    this.form.controls.committeeUids.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(this.uidsEqual), takeUntilDestroyed(this.destroyRef))
      .subscribe((uids) => this.fetchRecipientCountFor(uids ?? []));
  }

  private fetchRecipientCountFor(uids: string[]): void {
    if (!uids || uids.length === 0) {
      this.recipientCount.set(0);
      return;
    }
    if (!this.hasContext()) {
      return;
    }
    this.recipientCountLoading.set(true);
    this.newsletterService
      .getRecipientCount(this.projectUid(), { committee_uids: uids })
      .pipe(
        take(1),
        finalize(() => this.recipientCountLoading.set(false))
      )
      .subscribe({
        next: (res) => this.recipientCount.set(res.count),
        error: () => this.recipientCount.set(null),
      });
  }

  private initCommittees(): Signal<Committee[]> {
    return toSignal(
      toObservable(this.projectUid).pipe(
        distinctUntilChanged(),
        switchMap((uid) => {
          this.committeesError.set(null);
          if (!uid) return of([] as Committee[]);
          this.committeesLoading.set(true);
          return this.committeeService.getCommitteesByProjectOrThrow(uid).pipe(
            catchError(() => {
              this.committeesError.set('Could not load groups. Please try again.');
              return of([] as Committee[]);
            }),
            finalize(() => this.committeesLoading.set(false))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      ),
      { initialValue: [] as Committee[] }
    );
  }

  /**
   * Owns audience normalization at the form level so it applies regardless of which
   * step/view is mounted — the audience step's own picker only renders while the
   * stepper is on step 1, but save/send can happen from the Review view. Tracks
   * `committeeUidsValue` (not just `eligibleCommitteeUids`) so a draft loaded via
   * `patchValue({ emitEvent: false })` after eligibility has already resolved still
   * gets re-checked.
   */
  private initAudienceNormalization(): void {
    effect(() => {
      const eligible = this.eligibleCommitteeUids();
      const current = this.committeeUidsValue();
      if (!eligible) return;

      const filtered = current.filter((uid) => eligible.has(uid));
      if (filtered.length !== current.length) {
        this.form.controls.committeeUids.setValue(filtered);
      }
    });
  }

  private runSend(): void {
    const id = this.newsletterId();
    if (!id) {
      // Newsletter has to be saved as a draft first — the Go service owns the
      // create/send transition. The Save-as-Draft flow ensures id is populated
      // before this point in normal use; defensive guard for race conditions.
      this.messageService.add({
        severity: 'warn',
        summary: 'Save first',
        detail: 'Save the newsletter as a draft before sending.',
      });
      return;
    }
    this.submitting.set(true);

    // Audience normalization only mutates the form; runSend sends the *persisted*
    // newsletter by id/version, so a normalized-but-unsaved committee_uids value
    // would otherwise still deliver to the stale, un-normalized audience on the
    // server. Force a save first whenever the form has drifted from what's saved.
    //
    // Wait out any autosave already in flight first — saveDraft isn't routed
    // through the saveTrigger$/concatMap channel here, so firing it directly
    // while autosave's own PUT is still pending would race the same version
    // and one of the two would 409. canSend also disables Send while
    // savingDraft() is true; this is defense-in-depth for the click that
    // slips in during the flip.
    const ensureSaved$ = toObservable(this.savingDraft).pipe(
      filter((saving) => !saving),
      take(1),
      switchMap(() => (this.snapshotMatchesLastSaved() ? of(true) : this.saveDraft(true).pipe(map((draft) => draft !== null))))
    );

    ensureSaved$
      .pipe(
        switchMap((saved) => {
          if (!saved) return EMPTY;
          return this.newsletterService.sendNewsletter(this.projectUid(), id, this.version());
        }),
        finalize(() => this.submitting.set(false))
      )
      .subscribe({
        next: (result: NewsletterSendResult) => this.handleSendResponse(result),
        error: (err: HttpErrorResponse) => this.handleSendError(err, id),
      });
  }

  /**
   * The upstream send is asynchronous: acceptance returns the newsletter in
   * status='sending' (fan-out completes in a background job), while
   * status='sent' means it settled synchronously (zero-recipient edge case, or
   * a pre-async upstream deployment). Both land on the Sent tab — there is
   * deliberately no in-app progress indicator.
   */
  private handleSendResponse(result: NewsletterSendResult): void {
    if (result.newsletter.status === 'sending') {
      const total = result.total_recipients;
      this.messageService.add({
        severity: 'info',
        summary: 'Sending newsletter',
        detail: `Your newsletter is being sent to ${total} ${total === 1 ? 'recipient' : 'recipients'}.`,
      });
      this.goToList('sent');
      return;
    }
    if (result.failed > 0) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Sent with errors',
        detail: `Delivered ${result.sent} of ${result.total_recipients}. ${result.failed} failed.`,
        life: 8000,
      });
    } else {
      this.messageService.add({
        severity: 'success',
        summary: 'Newsletter sent',
        detail: `Delivered to ${result.sent} ${result.sent === 1 ? 'recipient' : 'recipients'}.`,
      });
    }
    this.goToList('sent');
  }

  /**
   * A send error is ambiguous: a timeout or 5xx may have raced a send the
   * upstream actually accepted (or even completed), and a 409 means one is
   * definitely in flight. Refetch the newsletter and branch on its real status
   * instead of unconditionally re-arming Send — the previous handler did the
   * latter, inviting the duplicate delivery in LFXV2-2604.
   */
  private handleSendError(err: HttpErrorResponse, id: string): void {
    this.resolvingSend.set(true);
    this.newsletterService
      .getNewsletter(this.projectUid(), id)
      .pipe(
        take(1),
        finalize(() => this.resolvingSend.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (newsletter) => {
          if (newsletter.status === 'sent' || newsletter.status === 'sending') {
            this.messageService.add({
              severity: 'info',
              summary: newsletter.status === 'sent' ? 'Newsletter sent' : 'Sending newsletter',
              detail: newsletter.status === 'sent' ? 'Your newsletter was sent.' : 'Your newsletter is being sent.',
            });
            this.goToList('sent');
            return;
          }
          // Genuinely still a draft — the send did not go through. Refresh the
          // version (the failed attempt or an earlier save may have bumped it)
          // so the next attempt doesn't fail on a stale If-Match.
          this.version.set(newsletter.version);
          this.messageService.add({
            severity: 'error',
            summary: 'Send failed',
            detail: err?.error?.message || err?.message || 'Could not send newsletter. Please try again.',
          });
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: 'Send failed',
            detail: 'Could not confirm the send status. Check the Sent tab before trying again.',
            life: 8000,
          });
        },
      });
  }

  private initCurrentStep(): Signal<number> {
    const initialStep = this.parseStepParam(this.route.snapshot.queryParamMap.get('step'));
    this.internalStep.set(initialStep);

    return toSignal(
      combineLatest([toObservable(this.isEditMode), this.route.queryParamMap, toObservable(this.internalStep)]).pipe(
        map(([editMode, params, internal]) => (editMode ? this.parseStepParam(params.get('step')) : internal))
      ),
      { initialValue: initialStep }
    );
  }

  private initViewMode(): Signal<NewsletterManageViewMode> {
    // Initial-value path runs synchronously before isEditMode reacts to the loaded
    // newsletterId; derive editMode from the snapshot id param so first paint is correct.
    const initialIsEdit = this.route.snapshot.paramMap.get('id') !== null;
    const initial = this.deriveViewMode(initialIsEdit, this.route.snapshot.queryParamMap.get('view'), this.route.snapshot.queryParamMap.get('step'));

    return toSignal(
      combineLatest([toObservable(this.isEditMode), this.route.queryParamMap]).pipe(
        map(([editMode, params]) => this.deriveViewMode(editMode, params.get('view'), params.get('step')))
      ),
      { initialValue: initial }
    );
  }

  private deriveViewMode(isEdit: boolean, view: string | null, step: string | null): NewsletterManageViewMode {
    if (!isEdit) return 'step';
    if (view === 'review') return 'review';
    // Step param means the user explicitly entered the stepper (or bookmarked / refreshed there).
    if (step) return 'step';
    return 'review';
  }

  private runDeleteDraft(id: string): void {
    const projectUid = this.projectUid();
    if (!projectUid) {
      // Mirrors the runSend guard — without surfacing this, the user clicks Delete, confirms,
      // and nothing happens.
      this.messageService.add({
        severity: 'warn',
        summary: 'Project context unavailable',
        detail: 'Reload the page and try again.',
      });
      return;
    }
    this.deletingDraft.set(true);
    this.newsletterService
      .deleteNewsletter(projectUid, id)
      .pipe(
        take(1),
        finalize(() => this.deletingDraft.set(false))
      )
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Draft deleted', detail: 'The draft has been removed.' });
          this.goToList();
        },
        error: (err: HttpErrorResponse) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Delete failed',
            detail: err?.error?.message || err?.message || 'Could not delete the draft. Please try again.',
          });
        },
      });
  }

  private parseStepParam(raw: string | null): number {
    if (!raw) return 1;
    const step = parseInt(raw, 10);
    if (step >= 1 && step <= this.totalSteps) return step;
    return 1;
  }

  private initContextLogo(): void {
    toObservable(this.activeContext)
      .pipe(
        switchMap((ctx) => {
          if (ctx?.logoUrl || !ctx?.slug) {
            this.fetchedLogoUrl.set(undefined);
            return of(undefined);
          }
          return this.projectService.getProject(ctx.slug, false).pipe(
            map((project) => project?.logo_url || undefined),
            catchError(() => of(undefined))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((url) => this.fetchedLogoUrl.set(url));
  }

  private initLoadDraft(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.newsletterId.set(id);

    // Wait for ProjectContextService to hydrate before fetching the draft.
    // A synchronous hasContext() check here would race the lens / persona
    // resolution on hard refreshes — deep links would bounce to the list
    // before the project becomes available. Subscribing once hasContext()
    // turns true loads the draft as soon as context lands, whether that
    // happens before or after the component initializes.
    toObservable(this.hasContext)
      .pipe(
        filter((ready) => ready),
        take(1),
        tap(() => this.draftLoading.set(true)),
        switchMap(() => this.newsletterService.getNewsletter(this.projectUid(), id).pipe(finalize(() => this.draftLoading.set(false)))),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (draft) => this.populateFormFromDraft(draft),
        error: (err: HttpErrorResponse) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Could not load draft',
            detail: err?.error?.message || err?.message || 'The draft may have been deleted or is unavailable.',
          });
          this.goToList();
        },
      });
  }

  private populateFormFromDraft(draft: Newsletter): void {
    this.version.set(draft.version);
    const committeeUids = draft.committee_uids ?? [];
    const subject = draft.subject ?? '';
    const bodyHtml = draft.body_html ?? '';
    this.form.patchValue({ committeeUids, subject, bodyHtml }, { emitEvent: false });
    this.committeeUidsValue.set(committeeUids);
    this.subjectValue.set(subject);
    this.bodyValue.set(bodyHtml);
    this.fetchRecipientCountFor(committeeUids);
  }

  private initSaveChannel(): void {
    this.saveTrigger$
      .pipe(
        concatMap((isManual) => this.saveDraft(isManual)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private initAutosave(): void {
    combineLatest([this.form.valueChanges, toObservable(this.edEmail)])
      .pipe(
        debounceTime(1000),
        // Never autosave while a send is in flight: the PUT would bump the
        // newsletter's version mid-send and race the upstream status
        // transition (the direct cause of the LFXV2-2604 duplicate-send
        // incident). The upstream also rejects edits while status='sending',
        // but suppressing the write here avoids surfacing that 409 as a
        // spurious save-error toast.
        filter(([, email]) => !this.submitting() && !this.resolvingSend() && this.hasContext() && this.hasAnythingToSave() && email.length > 0),
        filter(() => !this.snapshotMatchesLastSaved()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.saveTrigger$.next(false));
  }

  private snapshotMatchesLastSaved(): boolean {
    const saved = this.lastSavedSnapshot();
    if (!saved) return false;
    return (
      saved.subject === this.form.controls.subject.value &&
      saved.bodyHtml === this.form.controls.bodyHtml.value &&
      this.uidsEqual(saved.committeeUids, this.form.controls.committeeUids.value)
    );
  }

  private uidsEqual(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
    const av = a ?? [];
    const bv = b ?? [];
    if (av === bv) return true;
    if (av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) return false;
    }
    return true;
  }

  private hasAnythingToSave(): boolean {
    return this.audienceFilled() && this.subjectFilled() && this.bodyFilled();
  }

  private saveDraft(isManual = false) {
    if (!isManual && this.snapshotMatchesLastSaved()) {
      return EMPTY;
    }
    const projectUid = this.projectUid();
    if (!projectUid) {
      return EMPTY;
    }

    const id = this.newsletterId();
    this.savingDraft.set(true);
    const clearSavingFlags = () => {
      this.savingDraft.set(false);
      if (isManual) this.manualSaving.set(false);
    };
    // Serialize once; same shape works for create and update because both
    // requests accept the same body fields.
    const basePayload = {
      subject: this.form.controls.subject.value,
      body_html: this.form.controls.bodyHtml.value,
      committee_uids: this.form.controls.committeeUids.value,
      ed_reply_email: this.edEmail(),
    };
    const snapshotKey = {
      subject: basePayload.subject,
      bodyHtml: basePayload.body_html,
      committeeUids: [...basePayload.committee_uids],
    };

    if (id) {
      const update: UpdateNewsletterRequest = basePayload;
      return this.newsletterService.updateNewsletter(projectUid, id, this.version(), update).pipe(
        take(1),
        finalize(clearSavingFlags),
        map((draft) => {
          this.version.set(draft.version);
          this.savedAt.set(new Date());
          this.recordSavedSnapshot(snapshotKey);
          if (isManual) this.notifyDraftSaved();
          return draft;
        }),
        catchError((err: HttpErrorResponse) => this.handleSaveError(err, isManual))
      );
    }

    const create: CreateNewsletterRequest = basePayload;
    return this.newsletterService.createNewsletter(projectUid, create).pipe(
      take(1),
      finalize(clearSavingFlags),
      map((draft) => {
        this.newsletterId.set(draft.id);
        this.version.set(draft.version);
        this.savedAt.set(new Date());
        this.recordSavedSnapshot(snapshotKey);
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { step: this.internalStep() },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
        if (isManual) this.notifyDraftSaved();
        return draft;
      }),
      catchError((err: HttpErrorResponse) => this.handleSaveError(err, isManual))
    );
  }

  private recordSavedSnapshot(payload: { subject: string; bodyHtml: string; committeeUids: string[] }): void {
    this.lastSavedSnapshot.set({
      subject: payload.subject,
      bodyHtml: payload.bodyHtml,
      committeeUids: [...payload.committeeUids],
    });
  }

  private notifyDraftSaved(): void {
    this.messageService.add({
      severity: 'success',
      summary: 'Draft saved',
      detail: 'Your newsletter draft was saved.',
    });
  }

  private handleSaveError(err: HttpErrorResponse, isManual: boolean) {
    if (err.status === 409) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Draft out of sync',
        detail: 'Another session updated this draft. Reload to continue.',
        life: 10_000,
      });
    } else {
      this.messageService.add({
        severity: 'error',
        summary: isManual ? 'Save failed' : 'Autosave failed',
        detail: err?.error?.message || err?.message || 'Could not save draft. Your changes are unsaved.',
        life: 8000,
      });
    }
    return of(null);
  }
}
