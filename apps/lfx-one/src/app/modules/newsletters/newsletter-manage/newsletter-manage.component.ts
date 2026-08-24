// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, effect, inject, Injector, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import {
  NEWSLETTER_COMMITTEE_CATEGORY,
  NEWSLETTER_SCHEDULE_MAX_HORIZON_HOURS,
  NEWSLETTER_SCHEDULE_MIN_LEAD_MINUTES,
  NEWSLETTER_STEP_TITLES,
  NEWSLETTER_TOTAL_STEPS,
} from '@lfx-one/shared/constants';
import {
  Committee,
  CreateNewsletterRequest,
  GenerateNewsletterResponse,
  Newsletter,
  NewsletterAudienceEmailAdd,
  NewsletterCancelScheduleResult,
  NewsletterManageViewMode,
  NewsletterScheduleResult,
  NewsletterScheduleWindowError,
  NewsletterSendResult,
  ProjectContext,
  UpdateNewsletterRequest,
} from '@lfx-one/shared/interfaces';
import {
  combineDateTime,
  formatFutureRelativeTime,
  formatRelativeTime,
  formatTo12HourInTimezone,
  getTimezoneUtcOffsetString,
  getUserTimezone,
  isValidEmail,
  stripHtml,
} from '@lfx-one/shared/utils';
import { newsletterScheduleWindowValidator, timeFormatValidator } from '@lfx-one/shared/validators';
import { CommitteeService } from '@services/committee.service';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { toZonedTime } from 'date-fns-tz';
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
  interval,
  map,
  merge,
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
  // The publication this edition is being composed into, carried on the
  // ?publication= query param because the composer sits at the flat
  // `newsletters/create` path rather than under `newsletters/:pubId`. Read once
  // from the entry snapshot: it is a create-time input, and the edition's
  // publication does not change while the composer is open.
  private readonly composePublicationId = signal<string | undefined>(this.route.snapshot.queryParamMap.get('publication') ?? undefined);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly newsletterService = inject(NewsletterService);
  private readonly committeeService = inject(CommitteeService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly platformId = inject(PLATFORM_ID);

  // === Forms ===
  // Form control names stay camelCase (Angular convention). API payloads
  // are serialized to snake_case at the boundary in saveDraft / runSend.
  // Group-level newsletterScheduleWindowValidator() reports scheduleWindow
  // errors ('past' | 'tooSoon' | 'tooFar') off the group rather than a single
  // control, since it reads scheduleDate + scheduleTime + scheduleTimezone
  // together (see scheduleWindowError()).
  public readonly form = new FormGroup(
    {
      committeeUids: new FormControl<string[]>([], { nonNullable: true }),
      subject: new FormControl<string>('', { nonNullable: true }),
      bodyHtml: new FormControl<string>('', { nonNullable: true }),
      sendMode: new FormControl<'now' | 'schedule'>('now', { nonNullable: true }),
      scheduleDate: new FormControl<Date | null>(null),
      // timeFormatValidator rejects an out-of-range free-typed value (e.g. "13:99 PM")
      // that would otherwise survive into combineDateTime, which normalizes rather
      // than rejects overflow — see scheduleWindowError()'s 'invalidFormat' branch.
      scheduleTime: new FormControl<string>('', { nonNullable: true, validators: [timeFormatValidator()] }),
      // Seeded from the browser's resolved IANA zone in the constructor (SSR has
      // no reliable Intl timezone), so this stays 'UTC' until initScheduleTimezone runs.
      scheduleTimezone: new FormControl<string>('UTC', { nonNullable: true }),
    },
    { validators: newsletterScheduleWindowValidator() }
  );

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
  public readonly scheduling = signal<boolean>(false);
  public readonly cancelingSchedule = signal<boolean>(false);
  // Loaded newsletter's upstream status. Only 'scheduled' currently changes UI
  // behavior (read-only banner) — 'sending'/'sent' newsletters never reach this
  // screen (edit routes redirect from the list before landing here).
  private readonly newsletterStatus = signal<Newsletter['status'] | null>(null);
  public readonly isScheduleReadOnly = computed(() => this.newsletterStatus() === 'scheduled');

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
  // Public: the audience step consumes this directly rather than re-deriving its own
  // valueChanges-based signal, since patchValue({ emitEvent: false }) on draft hydration
  // (see populateFormFromDraft) would otherwise leave a child-owned signal stale forever.
  public readonly committeeUidsValue = signal<string[]>([]);
  private readonly subjectValue = signal<string>('');
  private readonly bodyValue = signal<string>('');
  public readonly sendModeValue = signal<'now' | 'schedule'>('now');
  public readonly scheduleDateValue = signal<Date | null>(null);
  public readonly scheduleTimeValue = signal<string>('');
  public readonly scheduleTimezoneValue = signal<string>('UTC');
  // Date-granular picker guard rails (min/max on <lfx-calendar>) — a coarse
  // first line of defense only. The exact minLead/72h window is the
  // validator's job (scheduleWindowError()); these just keep the calendar
  // from opening on a day that could never satisfy it.
  public readonly scheduleMinDate = new Date();
  public readonly scheduleMaxDate = new Date(Date.now() + NEWSLETTER_SCHEDULE_MAX_HORIZON_HOURS * 60 * 60 * 1000);

  // === Schedule derived state ===
  // null whenever the picker is incomplete or send-now is selected — combineDateTime
  // itself also returns '' on unparsable input, normalized to null here.
  public readonly scheduleAtIso = computed<string | null>(() => {
    if (this.sendModeValue() !== 'schedule') return null;
    const date = this.scheduleDateValue();
    const time = this.scheduleTimeValue();
    if (!date || !time) return null;
    const iso = combineDateTime(date, time, this.scheduleTimezoneValue());
    return iso || null;
  });
  // Ticks once a minute (browser only) so scheduleWindowError below re-evaluates purely from
  // clock advancement — a picked time can drift from 'valid' into 'tooSoon'/'past' on a tab
  // left open with no form interaction at all. See initScheduleClock.
  private readonly scheduleClockTick = signal(0);
  // Read off the group (not a single control) since newsletterScheduleWindowValidator()
  // is attached at the FormGroup level — see the `form` doc comment. `FormGroup.errors` is a
  // plain getter, not a signal, so this computed must read the mirror signals the validator
  // actually depends on (mode/date/time/timezone), plus scheduleClockTick for elapsed-time-only
  // changes, to know when to re-evaluate — otherwise it memoizes the first result forever.
  public readonly scheduleWindowError = computed<NewsletterScheduleWindowError | null>(() => {
    const sendMode = this.sendModeValue();
    this.scheduleDateValue();
    this.scheduleTimeValue();
    this.scheduleTimezoneValue();
    this.scheduleClockTick();
    // Gate every reason on schedule mode — the validator itself doesn't know
    // about sendMode (it just reads the date/time controls), so stale picker
    // values left over from a prior schedule pick would otherwise still
    // surface 'past'/'tooSoon'/'tooFar' after switching to Send now, which
    // would spuriously fire initSchedulePastGuard's toast-and-clear below.
    if (sendMode !== 'schedule') return null;
    // Check the control's own format error before the group-level window error —
    // an out-of-range free-typed time (e.g. "13:99 PM") normalizes into a valid
    // instant via combineDateTime instead of failing, so scheduleWindow would
    // otherwise never catch it.
    if (this.form.controls.scheduleTime.invalid) {
      return 'invalidFormat';
    }
    return this.form.errors?.['scheduleWindow'] ?? null;
  });
  // Live lower bound for the time picker's dropdown (see TimePickerComponent's
  // minDateTime input) — re-derived off scheduleClockTick so a tab left open long
  // enough drops the now-too-soon options from the list rather than only rejecting
  // them after the fact via scheduleWindowError.
  public readonly scheduleMinDateTime = computed<Date>(() => {
    this.scheduleClockTick();
    return new Date(Date.now() + NEWSLETTER_SCHEDULE_MIN_LEAD_MINUTES * 60 * 1000);
  });
  public readonly scheduleSummary = computed<string>(() => {
    const iso = this.scheduleAtIso();
    if (!iso) return '';
    const date = new Date(iso);
    const timezone = this.scheduleTimezoneValue();
    const dateLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone });
    const timeLabel = formatTo12HourInTimezone(date, timezone);
    const offset = getTimezoneUtcOffsetString(timezone, date);
    return `Sends ${dateLabel} at ${timeLabel} (UTC${offset}) — ${formatFutureRelativeTime(date)}`;
  });

  // === Save dedup ===
  // scheduledAt included so a schedule-only edit (picker changed, nothing else)
  // isn't deduped as "nothing to save" by snapshotMatchesLastSaved.
  private readonly lastSavedSnapshot = signal<{ subject: string; bodyHtml: string; committeeUids: string[]; scheduledAt: string | null } | null>(null);
  private readonly saveTrigger$ = new Subject<boolean>();

  // === Recipient summary ===
  protected readonly recipientCount = signal<number | null>(null);
  protected readonly recipientCountLoading = signal<boolean>(false);
  // Draft-load fires an immediate count request for the (possibly unfiltered)
  // saved uids; audience normalization can follow shortly after with a
  // setValue for the filtered uids. Routing both through one switchMap-based
  // pipeline (rather than each firing its own independent subscription)
  // cancels the stale in-flight request instead of letting it race the
  // normalized one and clobber the displayed count.
  private readonly recipientCountTrigger$ = new Subject<string[]>();

  // === Audience email adds ===
  // Owned here (not by the audience step) because the stepper destroys the step
  // panel on navigation — in-flight adds and their per-email statuses must
  // survive the user moving between steps. The step renders this filtered to
  // the currently selected group.
  protected readonly audienceEmailAdds = signal<NewsletterAudienceEmailAdd[]>([]);

  // === Newsletter-eligible committees ===
  // Fetched once here (not duplicated in the audience-step child) and passed down
  // via inputs, since the upstream endpoint fans out through fetchAllQueryResources.
  protected readonly committeesLoading = signal<boolean>(false);
  protected readonly committeesError = signal<string | null>(null);
  private readonly retryCommittees$ = new Subject<void>();
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
  // Send resolves recipients live from committee membership, so an inline add
  // still in flight for the selected group must land before an (irreversible)
  // send — otherwise that email is silently omitted from this newsletter. Step
  // navigation stays non-blocking; only Send waits, and adds settle in seconds.
  private readonly hasPendingAudienceAdds = computed(() => {
    const committeeUid = this.committeeUidsValue()[0];
    if (!committeeUid) return false;
    return this.audienceEmailAdds().some((e) => e.committeeUid === committeeUid && e.status === 'pending');
  });
  public readonly canSend = computed(
    () =>
      this.audienceFilled() &&
      this.audienceNormalized() &&
      this.subjectFilled() &&
      this.bodyFilled() &&
      this.hasContext() &&
      !this.submitting() &&
      !this.resolvingSend() &&
      !this.savingDraft() &&
      !this.scheduling() &&
      !this.hasPendingAudienceAdds() &&
      !this.isScheduleReadOnly()
  );
  public readonly canSendTest = computed(
    () => this.subjectFilled() && this.bodyFilled() && this.hasContext() && this.edEmail().length > 0 && !this.testSending() && !this.isScheduleReadOnly()
  );
  // Same gates as canSend, plus a valid armable time. scheduleWindowError() covers
  // 'tooSoon'/'tooFar' directly; 'past' is handled separately by an effect that resets
  // sendMode to 'now' (see initSchedulePastGuard), so it should never surface here.
  public readonly canSchedule = computed(
    () =>
      this.audienceFilled() &&
      this.audienceNormalized() &&
      this.subjectFilled() &&
      this.bodyFilled() &&
      this.hasContext() &&
      !this.submitting() &&
      !this.resolvingSend() &&
      !this.savingDraft() &&
      !this.scheduling() &&
      !this.hasPendingAudienceAdds() &&
      !this.isScheduleReadOnly() &&
      this.scheduleAtIso() !== null &&
      this.scheduleWindowError() === null
  );
  public readonly canProceed = computed(() => this.computeCanProceed(this.currentStep()));
  public readonly canGoPrevious = computed(() => this.currentStep() > 1);
  public readonly canGoNext = computed(() => this.currentStep() < this.totalSteps && this.canProceed());
  public readonly canSaveDraft = computed(
    () =>
      this.hasContext() &&
      this.audienceFilled() &&
      this.audienceNormalized() &&
      this.subjectFilled() &&
      this.bodyFilled() &&
      this.edEmail().length > 0 &&
      !this.savingDraft() &&
      !this.scheduling() &&
      !this.isScheduleReadOnly()
  );
  public readonly isLastStep = computed(() => this.currentStep() === this.totalSteps);
  public readonly currentStepTitle = computed(() => NEWSLETTER_STEP_TITLES[this.currentStep()] ?? '');
  protected readonly savedLabel = computed(() => {
    const at = this.savedAt();
    if (!at) return null;
    return `Saved ${formatRelativeTime(at)}`;
  });

  public constructor() {
    this.initScheduleTimezone();
    this.initContextLogo();
    this.initFormMirrors();
    this.initLoadDraft();
    this.initSaveChannel();
    this.initAutosave();
    this.initRecipientCount();
    this.initAudienceNormalization();
    this.initScheduleClock();
    this.initSchedulePastGuard();
    this.initScheduleFieldLock();
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

  // Enter the stepper at a specific step from the Review screen. Upstream rejects any
  // edit/save on a scheduled newsletter (409 'scheduled') — the review template already hides
  // these Edit affordances while isScheduleReadOnly(), this is the defense-in-depth backstop.
  protected enterStep(step: number): void {
    if (step < 1 || step > this.totalSteps || this.isScheduleReadOnly()) return;
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
    if (!id || this.deletingDraft() || this.isScheduleReadOnly()) return;
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

  protected onSchedule(): void {
    if (!this.canSchedule()) return;
    const count = this.recipientCount();
    const recipientLabel = count !== null && count > 0 ? `${count} ${count === 1 ? 'recipient' : 'recipients'}` : 'the selected groups';
    this.confirmationService.confirm({
      key: 'newsletter-manage',
      header: 'Schedule newsletter?',
      message: `This will schedule your newsletter to send to ${recipientLabel} ${this.scheduleSummary().replace(/^Sends /, 'on ')}.`,
      icon: 'pi pi-clock',
      acceptLabel: 'Schedule',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.runSchedule(),
    });
  }

  protected onCancelSchedule(): void {
    const id = this.newsletterId();
    if (!id || this.cancelingSchedule()) return;
    this.confirmationService.confirm({
      key: 'newsletter-manage',
      header: 'Cancel schedule?',
      message: 'This newsletter will return to Drafts. Your picked time is kept, so you can re-schedule it later.',
      icon: 'pi pi-times-circle',
      acceptLabel: 'Cancel schedule',
      rejectLabel: 'Keep scheduled',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.runCancelSchedule(id),
    });
  }

  protected retryCommittees(): void {
    this.retryCommittees$.next();
  }

  // Fired by the audience step for each email the user submits. Every add is an
  // independent, non-blocking request: the step's input clears immediately and
  // the per-email status here drives the inline indicator.
  protected onAddAudienceEmail(raw: string): void {
    const committeeUid = this.committeeUidsValue()[0];
    if (!committeeUid) return;

    const email = raw.trim().toLowerCase();
    if (!email) return;

    // pending/added entries are in flight or just confirmed — retyping is a
    // no-op. invalid/failed/already entries are replaced so retyping acts as a
    // retry ('already' can become 'added' if the member was removed elsewhere
    // since). This keeps (committeeUid, email) unique, which the step's @for
    // tracking relies on.
    const existing = this.audienceEmailAdds().find((e) => e.committeeUid === committeeUid && e.email === email);
    if (existing && (existing.status === 'pending' || existing.status === 'added')) return;

    const entry: NewsletterAudienceEmailAdd = isValidEmail(email)
      ? { email, committeeUid, status: 'pending' }
      : { email, committeeUid, status: 'invalid', reason: 'Not a valid email' };
    this.audienceEmailAdds.update((entries) => [...entries.filter((e) => !(e.committeeUid === committeeUid && e.email === email)), entry]);

    if (entry.status === 'invalid') return;

    // Intentionally NOT takeUntilDestroyed: HttpClient aborts the request on
    // unsubscribe, which would silently cancel in-flight adds if the user left
    // the page. createCommitteeMember pipes take(1) and HTTP observables
    // complete after one response, so each subscription cleans itself up.
    this.committeeService.createCommitteeMember(committeeUid, { email }, { skipNotification: true }).subscribe({
      next: () => {
        this.updateAudienceEmailAdd(committeeUid, email, { status: 'added' });
        // Refresh the recipient pill only if this group is still the selected
        // audience — an add resolving after a group switch must not clobber
        // the new group's count.
        if (this.committeeUidsValue()[0] === committeeUid) {
          this.fetchRecipientCountFor(this.committeeUidsValue());
        }
      },
      error: (err: HttpErrorResponse) => {
        if (err.status === 409) {
          this.updateAudienceEmailAdd(committeeUid, email, { status: 'already' });
        } else {
          this.updateAudienceEmailAdd(committeeUid, email, { status: 'failed', reason: extractErrorMessage(err, 'Could not add. Try again.') });
        }
      },
    });
  }

  private goToList(tab?: 'draft' | 'scheduled' | 'sent'): void {
    this.router.navigate(['list'], {
      relativeTo: this.route.parent,
      queryParams: tab ? { tab } : undefined,
    });
  }

  private computeCanProceed(step: number): boolean {
    switch (step) {
      case 1:
        return this.audienceFilled() && this.audienceNormalized();
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
    this.form.controls.sendMode.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((v) => this.sendModeValue.set(v ?? 'now'));
    this.form.controls.scheduleDate.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((v) => this.scheduleDateValue.set(v ?? null));
    this.form.controls.scheduleTime.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((v) => this.scheduleTimeValue.set(v ?? ''));
    this.form.controls.scheduleTimezone.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((v) => this.scheduleTimezoneValue.set(v ?? 'UTC'));
  }

  /**
   * Seeds scheduleTimezone from the browser's resolved IANA zone. SSR has no
   * reliable Intl timezone resolution, so this stays the 'UTC' default until
   * the app rehydrates in the browser (see the `form` doc comment).
   */
  private initScheduleTimezone(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const timezone = getUserTimezone();
    this.form.controls.scheduleTimezone.setValue(timezone);
    this.scheduleTimezoneValue.set(timezone);
  }

  /**
   * FormGroup validators only re-run on a control value change — a picked time that's
   * currently 'valid' silently drifts into 'tooSoon' (and eventually 'past') purely from the
   * clock advancing, with no value change to trigger revalidation. Force a revalidation once a
   * minute and bump scheduleClockTick so the scheduleWindowError computed picks up the result.
   */
  private initScheduleClock(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    interval(60_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.form.updateValueAndValidity({ onlySelf: true, emitEvent: false });
        this.scheduleClockTick.update((n) => n + 1);
      });
  }

  /**
   * A tab left open past the picked time makes every autosave fail upstream
   * ('scheduled_at must be in the future'). 'past' resets to send-now;
   * 'tooSoon'/'tooFar' are left alone — they still save fine and only need to
   * disable the Schedule action (see canSchedule). Repo convention forbids
   * effect() for imperative side effects (form patches, toasts) — bridge the
   * signal to an observable instead.
   *
   * Skips while isScheduleReadOnly(): the minute clock (initScheduleClock)
   * makes scheduleWindowError re-evaluate purely from elapsed time, so once a
   * deep-linked armed newsletter's scheduled_at passes, this would otherwise
   * clear the picker and toast "pick a new time or send now" even though
   * edit/send are intentionally hidden for an armed row — the form here is a
   * read-only mirror of what's already committed at the provider, not
   * something the guard should be resetting.
   */
  private initSchedulePastGuard(): void {
    toObservable(this.scheduleWindowError)
      .pipe(
        filter((error) => error === 'past' && !this.isScheduleReadOnly()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.form.patchValue({ sendMode: 'now', scheduleDate: null, scheduleTime: '' });
        this.messageService.add({
          severity: 'warn',
          summary: 'Scheduled time passed',
          detail: 'Your scheduled time has passed — pick a new time or send now.',
        });
      });
  }

  /**
   * Disables the date/time controls while an arm request is in flight (scheduling()) so the
   * author can't change the picker mid-request — runSchedule re-reads scheduleAtIso() right
   * before the call goes out, so leaving the fields live during that window would let a fresh
   * edit slip in after the value has already been captured for the request but before the
   * response lands, arming a time the author no longer sees selected. Repo convention forbids
   * effect() for imperative side effects (see initSchedulePastGuard above) — bridge the signal
   * to an observable instead.
   */
  private initScheduleFieldLock(): void {
    toObservable(this.scheduling)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((locked) => {
        const dateControl = this.form.controls.scheduleDate;
        const timeControl = this.form.controls.scheduleTime;
        if (locked) {
          dateControl.disable({ emitEvent: false });
          timeControl.disable({ emitEvent: false });
        } else {
          dateControl.enable({ emitEvent: false });
          timeControl.enable({ emitEvent: false });
        }
      });
  }

  private initRecipientCount(): void {
    merge(this.form.controls.committeeUids.valueChanges.pipe(debounceTime(300), distinctUntilChanged(this.uidsEqual)), this.recipientCountTrigger$)
      .pipe(
        switchMap((uids) => this.fetchRecipientCount$(uids ?? [])),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private fetchRecipientCountFor(uids: string[]): void {
    this.recipientCountTrigger$.next(uids);
  }

  private updateAudienceEmailAdd(committeeUid: string, email: string, patch: Partial<NewsletterAudienceEmailAdd>): void {
    this.audienceEmailAdds.update((entries) => entries.map((e) => (e.committeeUid === committeeUid && e.email === email ? { ...e, ...patch } : e)));
  }

  private fetchRecipientCount$(uids: string[]) {
    if (!uids || uids.length === 0) {
      this.recipientCount.set(0);
      return EMPTY;
    }
    if (!this.hasContext()) {
      return EMPTY;
    }
    this.recipientCountLoading.set(true);
    return this.newsletterService.getRecipientCount(this.projectUid(), { committee_uids: uids }).pipe(
      finalize(() => this.recipientCountLoading.set(false)),
      tap({
        // Apply the response only if the requested uids still match the current
        // selection: a trigger fired just before a group switch can otherwise
        // land during the valueChanges debounce window and briefly show the old
        // group's count. The mirror is updated synchronously (initFormMirrors /
        // populateFormFromDraft), so a match here is authoritative.
        next: (res) => {
          if (this.uidsEqual(uids, this.committeeUidsValue())) {
            this.recipientCount.set(res.count);
          }
        },
        error: () => {
          if (this.uidsEqual(uids, this.committeeUidsValue())) {
            this.recipientCount.set(null);
          }
        },
      }),
      catchError(() => EMPTY)
    );
  }

  private initCommittees(): Signal<Committee[]> {
    return toSignal(
      merge(toObservable(this.projectUid).pipe(distinctUntilChanged()), this.retryCommittees$.pipe(map(() => this.projectUid()))).pipe(
        switchMap((uid) => {
          this.committeesError.set(null);
          if (!uid) return of([] as Committee[]);
          this.committeesLoading.set(true);
          return this.committeeService.getCommitteesByProjectOrThrow(uid).pipe(
            catchError(() => {
              // A single transient failure otherwise leaves eligibleCommitteeUids()
              // null forever — Send, save, and step-1 proceed all stay blocked with
              // no way to recover short of navigating away. retryCommittees() gives
              // users (surfaced on the Review screen) an explicit way back in.
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
   * gets re-checked. Also narrows a legacy multi-group draft to its first uid here
   * (not just in the audience step), since Review is what's mounted on reopen.
   */
  private initAudienceNormalization(): void {
    effect(() => {
      const eligible = this.eligibleCommitteeUids();
      const current = this.committeeUidsValue();
      if (!eligible) return;

      const filtered = current.filter((uid) => eligible.has(uid));
      const narrowed = filtered.length > 1 ? filtered.slice(0, 1) : filtered;
      if (narrowed.length !== current.length || narrowed.some((uid, i) => uid !== current[i])) {
        this.form.controls.committeeUids.setValue(narrowed);
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
    // toObservable requires an injection context; runSend is invoked from the confirm-dialog's
    // accept callback (a plain event handler), so the injector must be passed explicitly here.
    const ensureSaved$ = toObservable(this.savingDraft, { injector: this.injector }).pipe(
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

  private runSchedule(): void {
    const id = this.newsletterId();
    if (!id || !this.scheduleAtIso()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Save first',
        detail: 'Save the newsletter as a draft before scheduling.',
      });
      return;
    }
    this.scheduling.set(true);

    // Same ensureSaved$ pattern as runSend: land any pending autosave (and
    // refresh version()) before arming, since the arm call sends by id/version.
    const ensureSaved$ = toObservable(this.savingDraft, { injector: this.injector }).pipe(
      filter((saving) => !saving),
      take(1),
      switchMap(() => (this.snapshotMatchesLastSaved() ? of(true) : this.saveDraft(true).pipe(map((draft) => draft !== null))))
    );

    ensureSaved$
      .pipe(
        switchMap((saved) => {
          if (!saved) return EMPTY;
          // Re-read scheduleAtIso() here rather than capturing it before ensureSaved$: the
          // picker isn't frozen while the confirm dialog's autosave wait is in flight (canSchedule
          // disables the button once scheduling() flips true, but that only blocks a *new* click —
          // it doesn't stop the author from continuing to edit the already-open picker). Capturing
          // the value up front would arm whatever time was selected before the wait, even though
          // saveDraft(true) just persisted a newer one.
          const scheduledAt = this.scheduleAtIso();
          if (!scheduledAt) return EMPTY;
          return this.newsletterService.scheduleNewsletter(this.projectUid(), id, this.version(), scheduledAt);
        }),
        finalize(() => this.scheduling.set(false))
      )
      .subscribe({
        next: (result: NewsletterScheduleResult) => this.handleScheduleResponse(result),
        error: (err: HttpErrorResponse) => this.handleScheduleError(err, id),
      });
  }

  /**
   * Same synchronous-settlement edge case as handleSendResponse: a
   * zero-recipient audience (or a pre-async upstream) can return
   * status='sent' immediately instead of the usual 'sending' → 'scheduled'
   * arm-in-progress path. Mirror handleSendResponse's positive check on the
   * one known in-flight status ('sending') rather than a negated check —
   * 'scheduled' never comes back synchronously (the fan-out job settles to
   * it later), so treating it as a distinct in-flight branch is both
   * unreachable and, if the upstream contract ever grows a new status,
   * would silently misroute it into the "still arming" branch instead of
   * the settled-outcome one.
   */
  private handleScheduleResponse(result: NewsletterScheduleResult): void {
    this.newsletterStatus.set(result.newsletter.status);
    this.version.set(result.newsletter.version);
    if (result.newsletter.status !== 'sending') {
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
      return;
    }
    this.messageService.add({
      severity: 'info',
      summary: 'Scheduling newsletter',
      detail: `Your newsletter will be sent ${this.scheduleSummary().replace(/^Sends /, '')}.`,
    });
    this.goToList('scheduled');
  }

  /**
   * Errors branch on the BFF's upstreamCode passthrough (see
   * microservice.error.ts) so each condition reads distinctly from a generic
   * conflict. 409 send_in_progress/already_sent reuses handleSendError's
   * refetch-and-branch logic — the newsletter moved on without us, and
   * re-arming blind risks a duplicate send. 412 is a plain out-of-sync
   * If-Match failure (e.g. the 5-minute settlement sweep bumped version) —
   * simpler than a send race, so it gets its own message rather than a refetch.
   */
  private handleScheduleError(err: HttpErrorResponse, id: string): void {
    const upstreamCode = err?.error?.upstreamCode;
    if (err.status === 503) {
      this.messageService.add({
        severity: 'error',
        summary: 'Scheduling unavailable',
        detail: "Scheduling isn't available in this environment. Use Send now instead.",
        life: 8000,
      });
      return;
    }
    if (err.status === 409 && upstreamCode === 'scheduled') {
      // Someone else (another tab, or a retry that actually landed) armed this
      // draft first. A toast alone leaves newsletterStatus() at 'draft', so
      // isScheduleReadOnly() stays false and every edit/save/send control keeps
      // accepting input against a newsletter the upstream will now reject —
      // refetch and adopt the real status/version, same as runCancelSchedule's
      // conflict branch.
      this.newsletterService
        .getNewsletter(this.projectUid(), id)
        .pipe(take(1), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (newsletter) => {
            this.version.set(newsletter.version);
            this.newsletterStatus.set(newsletter.status);
            this.messageService.add({
              severity: 'warn',
              summary: 'Already scheduled',
              detail: 'This newsletter is already scheduled.',
            });
          },
          error: () => {
            this.messageService.add({
              severity: 'warn',
              summary: 'Already scheduled',
              detail: 'This newsletter is already scheduled. Reload the page to see the latest status.',
              life: 8000,
            });
          },
        });
      return;
    }
    if (err.status === 409 && (upstreamCode === 'send_in_progress' || upstreamCode === 'already_sent')) {
      this.handleSendError(err, id);
      return;
    }
    if (err.status === 412) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Draft out of sync',
        detail: 'Draft out of sync. Reload to continue.',
        life: 10_000,
      });
      return;
    }
    this.messageService.add({
      severity: 'error',
      summary: 'Schedule failed',
      detail: extractErrorMessage(err, 'Could not schedule the newsletter. Please try again.'),
      life: 8000,
    });
  }

  private runCancelSchedule(id: string): void {
    const projectUid = this.projectUid();
    if (!projectUid) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Project context unavailable',
        detail: 'Reload the page and try again.',
      });
      return;
    }
    this.cancelingSchedule.set(true);
    this.newsletterService
      .cancelSchedule(projectUid, id, this.version())
      .pipe(
        take(1),
        finalize(() => this.cancelingSchedule.set(false))
      )
      .subscribe({
        next: (result: NewsletterCancelScheduleResult) => {
          this.version.set(result.newsletter.version);
          this.newsletterStatus.set(result.newsletter.status);
          // A newsletter opened via a deep-linked `?step=N` while scheduled was locked
          // to review by isScheduleReadOnly(), leaving that param sitting unused in the
          // URL. Cancelling flips isScheduleReadOnly() false, and deriveViewMode would
          // then honor the stale param and jump straight to the stepper — clear it so
          // the author stays on the review screen they just cancelled from.
          this.backToReview();
          this.messageService.add({ severity: 'success', summary: 'Schedule cancelled', detail: 'The newsletter is back in Drafts.' });
        },
        error: (err: HttpErrorResponse) => {
          const upstreamCode = err?.error?.upstreamCode;
          if (err.status === 409 && upstreamCode === 'cancel_window_closed') {
            this.messageService.add({
              severity: 'warn',
              summary: 'Too late to cancel',
              detail: 'Too close to the send time to cancel. This newsletter will go out as scheduled.',
              life: 8000,
            });
            return;
          }
          if ((err.status === 409 && upstreamCode === 'already_sent') || err.status === 412) {
            // 412 is a generic version_mismatch, not necessarily "already sent" —
            // the fan-out can advance sending -> scheduled, or a concurrent cancel
            // can win, leaving the real status as scheduled or draft. Refetch and
            // branch on the actual status before choosing the toast.
            this.newsletterService
              .getNewsletter(projectUid, id)
              .pipe(take(1), takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: (newsletter) => {
                  this.version.set(newsletter.version);
                  this.newsletterStatus.set(newsletter.status);
                  // sent/sending must navigate away, same as handleSendError — leaving
                  // newsletterStatus at 'sent'/'sending' would clear isScheduleReadOnly
                  // (true only for 'scheduled') and re-enable the edit/send controls on
                  // a newsletter that has already gone out.
                  if (newsletter.status === 'sent' || newsletter.status === 'sending') {
                    this.messageService.add({
                      severity: 'warn',
                      summary: 'Already sent',
                      detail: newsletter.status === 'sent' ? 'This newsletter has already been sent.' : 'This newsletter is already being sent.',
                    });
                    this.goToList('sent');
                    return;
                  }
                  const copy: Record<string, { summary: string; detail: string }> = {
                    scheduled: { summary: 'Still scheduled', detail: 'The cancellation did not go through — this newsletter is still scheduled.' },
                    draft: { summary: 'Already cancelled', detail: 'This newsletter has already been moved back to Drafts.' },
                  };
                  const { summary, detail } = copy[newsletter.status] ?? { summary: 'Out of sync', detail: 'Reload the page to see the latest status.' };
                  this.messageService.add({ severity: 'warn', summary, detail });
                },
                error: () => {
                  this.messageService.add({
                    severity: 'warn',
                    summary: 'Out of sync',
                    detail: 'Could not confirm the current status. Reload the page to continue.',
                    life: 8000,
                  });
                },
              });
            return;
          }
          this.messageService.add({
            severity: 'error',
            summary: 'Cancel failed',
            detail: extractErrorMessage(err, 'Could not cancel the schedule. Please try again.'),
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
    // isScheduleReadOnly() is false at this point (status hydrates after the draft
    // loads), so a scheduled newsletter briefly resolves via the step/view params below
    // and then flips to 'review' once initViewMode() re-runs off the isScheduleReadOnly
    // observable — draftLoading() keeps both branches hidden in the meantime.
    const initialIsEdit = this.route.snapshot.paramMap.get('id') !== null;
    const initial = this.deriveViewMode(initialIsEdit, this.route.snapshot.queryParamMap.get('view'), this.route.snapshot.queryParamMap.get('step'), false);

    return toSignal(
      combineLatest([toObservable(this.isEditMode), this.route.queryParamMap, toObservable(this.isScheduleReadOnly)]).pipe(
        map(([editMode, params, readOnly]) => this.deriveViewMode(editMode, params.get('view'), params.get('step'), readOnly))
      ),
      { initialValue: initial }
    );
  }

  private deriveViewMode(isEdit: boolean, view: string | null, step: string | null, readOnly: boolean): NewsletterManageViewMode {
    if (!isEdit) return 'step';
    // A scheduled newsletter is locked to review regardless of a `?step=` query param —
    // otherwise a direct/bookmarked link to the stepper would bypass the read-only lock
    // and still reach the audience/content mutation handlers underneath it.
    if (readOnly) return 'review';
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
    this.newsletterStatus.set(draft.status);
    const committeeUids = draft.committee_uids ?? [];
    const subject = draft.subject ?? '';
    const bodyHtml = draft.body_html ?? '';

    // scheduled_at hydration mirrors populateFormWithMeetingData in
    // meeting-manage.component.ts: convert the saved UTC instant into the
    // picker's local date/time pair for the newsletter's own timezone (or the
    // browser's, for older drafts saved before per-draft timezone existed).
    let sendMode: 'now' | 'schedule' = 'now';
    let scheduleDate: Date | null = null;
    let scheduleTime = '';
    let scheduleTimezone = this.scheduleTimezoneValue();
    if (draft.scheduled_at) {
      const utcDate = new Date(draft.scheduled_at);
      scheduleTimezone = isPlatformBrowser(this.platformId) ? getUserTimezone() : scheduleTimezone;
      scheduleDate = toZonedTime(utcDate, scheduleTimezone);
      scheduleTime = formatTo12HourInTimezone(utcDate, scheduleTimezone);
      sendMode = 'schedule';
    }

    this.form.patchValue({ committeeUids, subject, bodyHtml, sendMode, scheduleDate, scheduleTime, scheduleTimezone }, { emitEvent: false });
    this.committeeUidsValue.set(committeeUids);
    this.subjectValue.set(subject);
    this.bodyValue.set(bodyHtml);
    this.sendModeValue.set(sendMode);
    this.scheduleDateValue.set(scheduleDate);
    this.scheduleTimeValue.set(scheduleTime);
    this.scheduleTimezoneValue.set(scheduleTimezone);
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
        // Never autosave while a send or a schedule arm is in flight: the PUT
        // would bump the newsletter's version mid-request and race the
        // upstream status transition (the direct cause of the LFXV2-2604
        // duplicate-send incident, and the same hazard for scheduleNewsletter
        // — see runSchedule's ensureSaved$ comment). The upstream also
        // rejects edits while status='sending', but suppressing the write
        // here avoids surfacing that 409 as a spurious save-error toast.
        filter(
          ([, email]) =>
            !this.submitting() &&
            !this.resolvingSend() &&
            !this.scheduling() &&
            !this.isScheduleReadOnly() &&
            this.hasContext() &&
            this.hasAnythingToSave() &&
            email.length > 0
        ),
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
      this.uidsEqual(saved.committeeUids, this.form.controls.committeeUids.value) &&
      saved.scheduledAt === this.scheduleAtIso()
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
    return this.audienceFilled() && this.audienceNormalized() && this.subjectFilled() && this.bodyFilled();
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
    // scheduled_at is always sent explicitly (including null) — PUT is
    // full-replace, so omitting it would silently clear a previously-saved
    // value or, worse, leave a stale one behind when the user switches back
    // to "Send now" (see the `form` doc comment and scheduleAtIso()).
    const basePayload = {
      subject: this.form.controls.subject.value,
      body_html: this.form.controls.bodyHtml.value,
      committee_uids: this.form.controls.committeeUids.value,
      ed_reply_email: this.edEmail(),
      scheduled_at: this.scheduleAtIso(),
    };
    const snapshotKey = {
      subject: basePayload.subject,
      bodyHtml: basePayload.body_html,
      committeeUids: [...basePayload.committee_uids],
      scheduledAt: basePayload.scheduled_at,
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

    // publication_id is only sent on create. The upstream service requires it
    // (an edition is always composed inside a publication, and there is no
    // project default to resolve to), and it is immutable afterwards — the PUT
    // omits the key entirely so the edition keeps its current publication.
    const create: CreateNewsletterRequest = { ...basePayload, publication_id: this.composePublicationId() };
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

  private recordSavedSnapshot(payload: { subject: string; bodyHtml: string; committeeUids: string[]; scheduledAt: string | null }): void {
    this.lastSavedSnapshot.set({
      subject: payload.subject,
      bodyHtml: payload.bodyHtml,
      committeeUids: [...payload.committeeUids],
      scheduledAt: payload.scheduledAt,
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
