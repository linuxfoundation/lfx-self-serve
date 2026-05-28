// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { NEWSLETTER_STEP_TITLES, NEWSLETTER_TOTAL_STEPS } from '@lfx-one/shared/constants';
import {
  CreateNewsletterDraftRequest,
  GenerateNewsletterResponse,
  Newsletter,
  NewsletterContextType,
  NewsletterSendResult,
  ProjectContext,
  UpdateNewsletterDraftRequest,
} from '@lfx-one/shared/interfaces';
import { formatRelativeTime, stripHtml } from '@lfx-one/shared/utils';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { StepperModule } from 'primeng/stepper';
import { catchError, combineLatest, concatMap, debounceTime, distinctUntilChanged, EMPTY, filter, finalize, map, of, Subject, switchMap, take } from 'rxjs';

import { NewsletterAudienceStepComponent } from '../components/newsletter-audience-step/newsletter-audience-step.component';
import { NewsletterContentStepComponent } from '../components/newsletter-content-step/newsletter-content-step.component';
import { NewsletterPreviewDrawerComponent } from '../components/newsletter-preview-drawer/newsletter-preview-drawer.component';
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
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);

  // === Forms ===
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
  public readonly testSending = signal<boolean>(false);
  public readonly savedAt = signal<Date | null>(null);
  public readonly savingDraft = signal<boolean>(false);
  // Manual Save-as-Draft spinner — kept separate from `savingDraft` so the autosave debounce
  // (which fires every ~1s while the user types) doesn't blink the manual button mid-typing.
  public readonly manualSaving = signal<boolean>(false);
  public readonly previewDrawerVisible = signal<boolean>(false);

  // === Step state ===
  private readonly internalStep = signal<number>(1);
  public readonly totalSteps = NEWSLETTER_TOTAL_STEPS;
  public readonly currentStep: Signal<number> = this.initCurrentStep();

  // === Project context ===
  public readonly activeContext: Signal<ProjectContext | null> = this.projectContextService.activeContext;
  public readonly isFoundationContext: Signal<boolean> = this.projectContextService.isFoundationContext;
  public readonly contextUid: Signal<string> = this.projectContextService.activeContextUid;
  public readonly contextType: Signal<NewsletterContextType> = computed(() => (this.isFoundationContext() ? 'foundation' : 'project'));
  public readonly displayName: Signal<string> = computed(() => this.activeContext()?.name ?? '');
  private readonly fetchedLogoUrl = signal<string | undefined>(undefined);
  public readonly logoUrl: Signal<string | undefined> = computed(() => this.activeContext()?.logoUrl || this.fetchedLogoUrl());
  public readonly hasContext: Signal<boolean> = computed(() => this.contextUid().length > 0);

  // === Auth-derived ===
  public readonly edName: Signal<string> = computed(() => {
    const user = this.userService.user();
    return user?.name || user?.given_name || user?.nickname || 'Executive Director';
  });
  public readonly edEmail: Signal<string> = computed(() => this.userService.user()?.email ?? '');

  // === Form mirrors ===
  // toSignal can't be used here — populateFormFromDraft patches with { emitEvent: false }; we seed manually.
  private readonly committeeUidsValue = signal<string[]>([]);
  private readonly subjectValue = signal<string>('');
  private readonly bodyValue = signal<string>('');

  // === Save dedup ===
  // Snapshot of the last persisted payload — autosave skips when the current form state matches,
  // preventing a redundant save after the user clicks Save as Draft while a debounce is in flight.
  private readonly lastSavedSnapshot = signal<{ subject: string; bodyHtml: string; committeeUids: string[] } | null>(null);
  // Shared save channel — both the autosave pipe and the manual button push isManual flags here;
  // concatMap serializes them so manual and auto saves can never run concurrently, and a queued
  // autosave reads the live form state at execution time (no edits dropped during in-flight saves).
  private readonly saveTrigger$ = new Subject<boolean>();

  // === Recipient summary (computed here so review/send steps can share it) ===
  protected readonly recipientCount = signal<number | null>(null);
  protected readonly recipientCountLoading = signal<boolean>(false);

  // === Validation gates ===
  public readonly subjectFilled = computed(() => (this.subjectValue() ?? '').trim().length > 0);
  public readonly bodyFilled = computed(() => stripHtml(this.bodyValue() ?? '').length > 0);
  public readonly audienceFilled = computed(() => (this.committeeUidsValue() ?? []).length > 0);
  public readonly canSend = computed(() => this.audienceFilled() && this.subjectFilled() && this.bodyFilled() && this.hasContext() && !this.submitting());
  public readonly canSendTest = computed(
    () => this.subjectFilled() && this.bodyFilled() && this.hasContext() && this.edEmail().length > 0 && !this.testSending()
  );
  public readonly canProceed = computed(() => this.computeCanProceed(this.currentStep()));
  public readonly canGoPrevious = computed(() => this.currentStep() > 1);
  public readonly canGoNext = computed(() => this.currentStep() < this.totalSteps && this.canProceed());
  // Mirror autosave's email gate — server validates edReplyEmail contains '@', so don't enable
  // the manual button until the user profile has loaded a usable email.
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
  }

  protected goToStep(step: number | undefined): void {
    if (step === undefined || step < 1 || step > this.totalSteps) return;
    // Only allow forward navigation if all previous steps are valid; backward is always fine.
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
      .testSend({
        subject: this.form.controls.subject.value,
        bodyHtml: this.form.controls.bodyHtml.value,
        toEmail: this.edEmail(),
        contextType: this.contextType(),
        contextUid: this.contextUid(),
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

  // `['..']` on a 2-segment route resolves to `/<id>` — anchor to route.parent + explicit 'list' child.
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
    this.recipientCountLoading.set(true);
    this.newsletterService
      .getRecipientCount({ committeeUids: uids })
      .pipe(
        take(1),
        finalize(() => this.recipientCountLoading.set(false))
      )
      .subscribe({
        next: (res) => this.recipientCount.set(res.count),
        error: () => this.recipientCount.set(null),
      });
  }

  private runSend(): void {
    this.submitting.set(true);
    const id = this.newsletterId();
    const send$ = id
      ? this.newsletterService.sendDraft(id, this.version())
      : this.newsletterService.send({
          subject: this.form.controls.subject.value,
          bodyHtml: this.form.controls.bodyHtml.value,
          committeeUids: this.form.controls.committeeUids.value,
          contextType: this.contextType(),
          contextUid: this.contextUid(),
          edReplyEmail: this.edEmail(),
        });

    send$
      .pipe(
        take(1),
        finalize(() => this.submitting.set(false))
      )
      .subscribe({
        next: (result: NewsletterSendResult) => {
          if (result.markSentFailed) {
            // Emails delivered but the newsletter row didn't flip to "sent".
            // Tell the operator explicitly — retrying would dispatch duplicates.
            this.messageService.add({
              severity: 'warn',
              summary: 'Sent — status update failed',
              detail: `Delivered to ${result.sent} ${result.sent === 1 ? 'recipient' : 'recipients'}, but the newsletter status couldn't be updated. Don't retry — contact support to reconcile.`,
              life: 12000,
            });
          } else if (result.failed > 0) {
            this.messageService.add({
              severity: 'warn',
              summary: 'Sent with errors',
              detail: `Delivered ${result.sent} of ${result.totalRecipients}. ${result.failed} failed.`,
              life: 8000,
            });
          } else {
            this.messageService.add({
              severity: 'success',
              summary: 'Newsletter sent',
              detail: `Delivered to ${result.sent} ${result.sent === 1 ? 'recipient' : 'recipients'}.`,
            });
          }
          // Land on the Sent tab on full success; on markSentFailed the row
          // is still a draft on the Go side, so don't mislead the operator
          // by routing them to Sent.
          this.goToList(result.markSentFailed ? 'draft' : 'sent');
        },
        error: (err: HttpErrorResponse) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Send failed',
            detail: err?.error?.message || err?.message || 'Could not send newsletter. Please try again.',
          });
        },
      });
  }

  private initCurrentStep(): Signal<number> {
    // Mode flips mid-flow when /create autosaves to edit — react to isEditMode() instead of fixing source at init.
    const initialStep = this.parseStepParam(this.route.snapshot.queryParamMap.get('step'));
    this.internalStep.set(initialStep);

    return toSignal(
      combineLatest([toObservable(this.isEditMode), this.route.queryParamMap, toObservable(this.internalStep)]).pipe(
        map(([editMode, params, internal]) => (editMode ? this.parseStepParam(params.get('step')) : internal))
      ),
      { initialValue: initialStep }
    );
  }

  private parseStepParam(raw: string | null): number {
    if (!raw) return 1;
    const step = parseInt(raw, 10);
    if (step >= 1 && step <= this.totalSteps) return step;
    return 1;
  }

  private initContextLogo(): void {
    // React to activeContext changes via toObservable + switchMap so each
    // context swap cancels the in-flight project fetch (instead of racing).
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
    this.draftLoading.set(true);
    this.newsletterService
      .getDraft(id)
      .pipe(
        take(1),
        finalize(() => this.draftLoading.set(false))
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
    const committeeUids = draft.committeeUids ?? [];
    const subject = draft.subject ?? '';
    const bodyHtml = draft.bodyHtml ?? '';
    this.form.patchValue({ committeeUids, subject, bodyHtml }, { emitEvent: false });
    // patchValue suppresses valueChanges — mirror manually or canProceed/canSend stay false on initial draft load.
    this.committeeUidsValue.set(committeeUids);
    this.subjectValue.set(subject);
    this.bodyValue.set(bodyHtml);
    // initRecipientCount listens to valueChanges, which won't fire here either.
    this.fetchRecipientCountFor(committeeUids);
  }

  private initSaveChannel(): void {
    // concatMap serializes manual + auto saves so they can never run concurrently. A queued autosave
    // reads form state at execution time, so edits typed during an in-flight save are not dropped.
    this.saveTrigger$
      .pipe(
        concatMap((isManual) => this.saveDraft(isManual)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private initAutosave(): void {
    // Combine with edEmail so a late-arriving profile triggers autosave even when the user hasn't typed since.
    // Snapshot dedup avoids queueing a save when the form already matches what's persisted.
    combineLatest([this.form.valueChanges, toObservable(this.edEmail)])
      .pipe(
        debounceTime(1000),
        filter(([, email]) => this.hasContext() && this.hasAnythingToSave() && email.length > 0),
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

  // Go service rejects partial drafts — only autosave once all three fields are filled to avoid 400 spam.
  private hasAnythingToSave(): boolean {
    return this.audienceFilled() && this.subjectFilled() && this.bodyFilled();
  }

  private saveDraft(isManual = false) {
    // Execution-time dedup: a queued autosave may have been enqueued before a manual save completed
    // and recorded its snapshot. Re-check at execution so the queued autosave is skipped if the form
    // already matches what's persisted. Manual saves always run — the user clicked the button.
    if (!isManual && this.snapshotMatchesLastSaved()) {
      return EMPTY;
    }

    const id = this.newsletterId();
    this.savingDraft.set(true);
    const clearSavingFlags = () => {
      this.savingDraft.set(false);
      if (isManual) this.manualSaving.set(false);
    };
    const basePayload = {
      subject: this.form.controls.subject.value,
      bodyHtml: this.form.controls.bodyHtml.value,
      committeeUids: this.form.controls.committeeUids.value,
      edReplyEmail: this.edEmail(),
    };

    if (id) {
      const update: UpdateNewsletterDraftRequest = basePayload;
      return this.newsletterService.updateDraft(id, this.version(), update).pipe(
        take(1),
        finalize(clearSavingFlags),
        map((draft) => {
          this.version.set(draft.version);
          this.savedAt.set(new Date());
          this.recordSavedSnapshot(basePayload);
          if (isManual) this.notifyDraftSaved();
          return draft;
        }),
        catchError((err: HttpErrorResponse) => this.handleSaveError(err, isManual))
      );
    }

    const create: CreateNewsletterDraftRequest = {
      contextType: this.contextType(),
      contextUid: this.contextUid(),
      ...basePayload,
    };
    return this.newsletterService.createDraft(create).pipe(
      take(1),
      finalize(clearSavingFlags),
      map((draft) => {
        this.newsletterId.set(draft.id);
        this.version.set(draft.version);
        this.savedAt.set(new Date());
        this.recordSavedSnapshot(basePayload);
        // Skip /:id/edit navigation — it tears down the component and wipes the form mid-typing.
        // Seed step in URL because isEditMode() just flipped — currentStep now reads from queryParamMap.
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

  // Surface save failures — silent failures let the user navigate away believing the draft saved.
  // savingDraft is reset by saveDraft's finalize; no need to re-set it here.
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
