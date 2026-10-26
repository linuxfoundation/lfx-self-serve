// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import {
  AEO_GEO_INTAKE_ERRORS,
  AEO_GEO_KEY_PAGE_FIELDS,
  AEO_GEO_RECENT_RUNS_LIMIT,
  AEO_GEO_QUESTION_KEY_PREFIX,
  AEO_GEO_TIMEOUT_MESSAGE,
  MKTG_AGENTS,
  MKTG_DOCUMENT_TYPES,
} from '@lfx-one/shared/constants';
import {
  MktgAgentIntake,
  MktgPendingDocumentRun,
  MktgRevisionResponse,
  MktgRunActivity,
  MktgRunAnswer,
  MktgRunQuestion,
  MktgRunQuestionDraft,
  MktgRunResultResponse,
} from '@lfx-one/shared/interfaces';
import { isAeoGeoKeyPageUrl, normalizeAeoGeoDomain, validateAeoGeoIntakeAnswers } from '@lfx-one/shared/utils';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { MktgPendingDocumentService } from '@services/mktg-pending-document.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { catchError, distinctUntilChanged, EMPTY, forkJoin, Observable, map, of, Subscription, switchMap, takeWhile, tap, TimeoutError } from 'rxjs';

import { MktgBreadcrumbComponent } from '../mktg-breadcrumb/mktg-breadcrumb.component';
import { MktgRunActivityComponent } from '../../mktg-run-activity/mktg-run-activity.component';
import { MktgRunQuestionsComponent } from '../../mktg-run-questions/mktg-run-questions.component';

/** Page-7 audit form, hosted by the catalog-driven run route. Results belong to the one Document view. */
@Component({
  selector: 'lfx-aeo-geo-run',
  imports: [
    DatePipe,
    DecimalPipe,
    ReactiveFormsModule,
    RouterLink,
    InputTextComponent,
    MessageComponent,
    MktgRunActivityComponent,
    MktgRunQuestionsComponent,
    MktgBreadcrumbComponent,
  ],
  templateUrl: './aeo-geo-run.component.html',
  styleUrl: './aeo-geo-run.component.scss',
})
export class AeoGeoRunComponent {
  private readonly documents = inject(MktgDocumentStoreService);
  private readonly pending = inject(MktgPendingDocumentService);
  private readonly projectContext = inject(ProjectContextService);
  private readonly projects = inject(ProjectService);
  private readonly user = inject(UserService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platform = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  public readonly intake = input.required<MktgAgentIntake>();
  protected readonly form = new FormGroup(
    Object.fromEntries(['domain', ...AEO_GEO_KEY_PAGE_FIELDS.map((field) => field.key)].map((key) => [key, new FormControl('', { nonNullable: true })]))
  );
  protected readonly loading = signal(true);
  protected readonly writer = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly previousError = signal('');
  protected readonly previousLoading = signal(true);
  protected readonly runs = signal<MktgRevisionResponse[]>([]);
  protected readonly runCount = signal(0);
  protected readonly visiblePages = signal(3);
  protected readonly prefill = signal('');
  protected readonly reload = signal(0);
  protected readonly activeRun = signal<MktgPendingDocumentRun | null>(null);
  protected readonly activity = signal<MktgRunActivity[]>([]);
  protected readonly questions = signal<MktgRunQuestion[]>([]);
  protected readonly answerValues = signal<Record<string, string>>({});
  protected readonly questionDraft = signal<MktgRunQuestionDraft | null>(null);
  private generation: Subscription | null = null;
  protected readonly startedAt = computed(() => Date.parse(this.activeRun()?.savedAt ?? '') || Date.now());
  protected readonly agent = computed(() => MKTG_AGENTS.find((entry) => entry.id === this.intake().agentId));
  protected readonly iconClass = computed(
    () =>
      ({
        blue: 'bg-blue-50 text-blue-600',
        emerald: 'bg-emerald-50 text-emerald-600',
        violet: 'bg-violet-50 text-violet-600',
        amber: 'bg-amber-50 text-amber-600',
        red: 'bg-red-50 text-red-600',
        gray: 'bg-gray-100 text-gray-500',
      })[this.agent()?.accent ?? 'gray']
  );
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly projectName = computed(() => this.projectContext.activeContext()?.name ?? '');
  protected readonly projectSlug = computed(() => this.projectContext.activeContext()?.slug ?? '');
  protected readonly documentType = computed(() => MKTG_DOCUMENT_TYPES.find((type) => type.catalogAgentId === this.intake().agentId));
  protected readonly pageFields = computed(() => AEO_GEO_KEY_PAGE_FIELDS.slice(0, this.visiblePages()));
  protected readonly answers = this.initAnswers();
  protected readonly validation = computed(() => validateAeoGeoIntakeAnswers(this.answers()));
  protected readonly domainName = this.initDomainName();
  protected readonly domainError = computed(() => (this.answers().domain.trim() && !this.domainName() ? AEO_GEO_INTAKE_ERRORS.domain : ''));
  protected readonly pagesError = this.initPagesError();
  protected readonly submitDisabled = computed(() => this.loading() || !this.writer() || !this.documentType() || this.busy() || !this.validation().valid);
  private readonly context$ = toObservable(
    computed(() => ({ context: this.projectContext.activeContext(), sub: this.user.user()?.sub, reload: this.reload() }))
  );

  public constructor() {
    if (!isPlatformBrowser(this.platform)) {
      return;
    }
    this.context$
      .pipe(
        distinctUntilChanged((a, b) => a.context?.uid === b.context?.uid && a.sub === b.sub && a.reload === b.reload),
        switchMap(({ context, sub }) => {
          this.generation?.unsubscribe();
          this.busy.set(false);
          this.activeRun.set(null);
          this.activity.set([]);
          this.questions.set([]);
          this.answerValues.set({});
          this.questionDraft.set(null);
          this.writer.set(false);
          this.loading.set(true);
          this.form.reset();
          this.prefill.set('');
          this.visiblePages.set(3);
          this.runs.set([]);
          this.runCount.set(0);
          this.error.set('');
          this.previousError.set('');
          this.previousLoading.set(true);
          if (!context || !sub) {
            this.loading.set(false);
            this.error.set('Select a valid project before running an audit.');
            return of(null);
          }
          const type = this.documentType();
          if (!type) {
            this.loading.set(false);
            this.error.set('This audit has no registered document type.');
            this.previousLoading.set(false);
            return of(null);
          }
          return this.projects.getProject(context.slug, true).pipe(
            switchMap((project) => {
              this.loading.set(false);
              if (!project) {
                this.error.set('The project could not be loaded. Try again.');
                this.previousLoading.set(false);
                return of(null);
              }
              this.writer.set(!!project.writer);
              if (!project.writer) {
                this.previousLoading.set(false);
                return of(null);
              }
              const pending = this.pending.loadActive(context.uid, this.intake().agentId);
              if (pending) {
                this.activeRun.set(pending);
                this.questionDraft.set(pending.questionDraft ?? null);
                // Recheck terminal status before redirecting a recovered writing capability.
                this.generation = this.watchRun(pending).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
              }
              const website = project.website_url ?? '';
              if (!this.form.controls['domain'].value.trim() && website) {
                this.form.controls['domain'].setValue(website);
                this.prefill.set(website);
              }
              return this.documents.listDocuments(context.uid).pipe(
                switchMap((response) => {
                  const group = response.groups.find((entry) => entry.type.agentKey === type.agentKey);
                  this.runCount.set(group?.documents.length ?? 0);
                  // The current API exposes summary sidecars on a full revision read.
                  // Bound those Markdown downloads; a summary-only endpoint is a follow-up.
                  const documents = group?.documents.slice(0, AEO_GEO_RECENT_RUNS_LIMIT) ?? [];
                  return documents.length
                    ? forkJoin(
                        documents.map((document) => this.documents.getRevision(context.uid, type.agentKey, document.documentId, document.latestRevisionId))
                      )
                    : of([]);
                }),
                catchError(() => {
                  this.previousError.set('Previous runs could not be loaded. Open Documents to try again.');
                  return of(null);
                })
              );
            })
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe((runs) => {
        this.runs.set(runs ?? []);
        this.previousLoading.set(false);
      });
  }

  protected onSubmit(): void {
    const context = this.projectContext.activeContext();
    const project = context?.uid;
    const type = this.documentType();
    if (!context || !project || !type || this.submitDisabled()) {
      return;
    }
    const stale = this.pending.loadActive(project, this.intake().agentId);
    if (stale) this.pending.clear(stale.projectUid, stale.documentId);
    this.busy.set(true);
    this.error.set('');
    this.answerValues.set({});
    this.questionDraft.set(null);
    this.questions.set([]);
    this.activity.set([]);
    this.generation = this.pending
      .start(this.intake(), project, { ...this.answers(), project_name: context.name, project_uid: project })
      .pipe(
        tap((run) => this.activeRun.set(run)),
        switchMap((run) => this.watchRun(run)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        error: (error: unknown) => {
          console.error('Failed to start the audit', error);
          this.busy.set(false);
          this.error.set('The audit could not be started. Your inputs are kept — try again.');
        },
      });
  }

  protected onRunAgain(): void {
    const run = this.activeRun();
    if (run) this.pending.clear(run.projectUid, run.documentId);
    this.generation?.unsubscribe();
    this.activeRun.set(null);
    this.questions.set([]);
    this.answerValues.set({});
    this.questionDraft.set(null);
    this.busy.set(false);
    this.error.set('');
  }

  protected onQuestionDraft(draft: MktgRunQuestionDraft): void {
    const run = this.activeRun();
    if (run) this.pending.saveQuestionDraft(run, draft);
  }

  protected onAnswers(answers: MktgRunAnswer[]): void {
    const run = this.activeRun();
    if (!run || this.busy() || !this.questions().length) {
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.answerValues.set(Object.fromEntries(answers.map((a) => [a.key, a.text])));
    this.questionDraft.set(null);
    this.generation = this.pending
      .answerQuestions(
        run,
        this.intake(),
        answers.map((a) => ({ id: a.key.slice(AEO_GEO_QUESTION_KEY_PREFIX.length), text: a.text, origin: a.origin }))
      )
      .pipe(
        tap(() => this.openDocument(run)),
        catchError((error: unknown) => {
          console.error('Failed to acknowledge audit answers', error);
          this.error.set('Your answers are kept. Checking whether the agent took them…');
          return this.watchRun(run).pipe(map(() => undefined));
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private initAnswers(): Signal<Record<'domain' | 'key_pages', string>> {
    return computed(() => {
      const values = this.values();
      return {
        domain: values['domain'] ?? '',
        key_pages: AEO_GEO_KEY_PAGE_FIELDS.map((field) => values[field.key]?.trim() ?? '')
          .filter(Boolean)
          .join('\n'),
      };
    });
  }

  private initDomainName(): Signal<string> {
    return computed(() => {
      try {
        return normalizeAeoGeoDomain(this.answers().domain);
      } catch {
        return '';
      }
    });
  }

  private initPagesError(): Signal<string> {
    return computed(() => {
      const pages = this.answers().key_pages.split('\n').filter(Boolean);
      if (pages.some((url) => !isAeoGeoKeyPageUrl(url))) {
        return AEO_GEO_INTAKE_ERRORS.key_pages;
      }
      if (new Set(pages).size !== pages.length) {
        return 'Use a different URL for each key page; remove any repeats.';
      }
      return pages.length === 1 ? 'Add at least one more page, or leave key pages empty and the agent picks them.' : '';
    });
  }

  private watchRun(run: MktgPendingDocumentRun): Observable<MktgRunResultResponse> {
    this.busy.set(true);
    return this.pending.poll(run, this.intake()).pipe(
      tap((result) => this.onRunResult(run, result)),
      takeWhile(
        (result) => result.status === 'pending' && (result.transient === true || (run.phase !== 'writing' && Object.keys(this.answerValues()).length === 0)),
        true
      ),
      catchError((error: unknown) => {
        console.error('Failed to poll the audit', error);
        if (error instanceof TimeoutError) {
          this.busy.set(false);
          this.error.set(AEO_GEO_TIMEOUT_MESSAGE);
        } else {
          this.failRun(run, 'The audit could not finish. Your inputs are kept — try again.');
        }
        return EMPTY;
      })
    );
  }

  private onRunResult(run: MktgPendingDocumentRun, result: MktgRunResultResponse): void {
    if (result.transient) return;
    if (this.intake().liveActivity && result.activity) {
      this.activity.set(result.activity);
    }
    if (result.status === 'pending') {
      this.questions.set([]);
      if (run.phase === 'writing' || Object.keys(this.answerValues()).length > 0) this.openDocument(run);
    }
    if (result.status === 'questions' && result.questions?.length && result.questionsId) {
      this.questions.set(result.questions);
      this.error.set('');
      this.busy.set(false);
    } else if (result.status === 'refused') {
      this.failRun(run, result.reply || 'The agent did not produce a report. Start a new audit.');
    } else if (result.status === 'ready') {
      this.openDocument(run);
    } else if (result.status !== 'pending') {
      this.failRun(run, 'The audit response could not be read. Start a new audit.');
    }
  }

  private failRun(run: MktgPendingDocumentRun, message: string): void {
    this.pending.clear(run.projectUid, run.documentId);
    this.activeRun.set(null);
    this.questions.set([]);
    this.questionDraft.set(null);
    this.busy.set(false);
    this.error.set(message);
  }

  private openDocument(run: MktgPendingDocumentRun): void {
    const type = this.documentType();
    if (!type || !this.pending.markWriting(run)) {
      return;
    }
    this.router.navigate(['..', 'documents', type.agentKey, run.documentId], {
      relativeTo: this.route,
      queryParamsHandling: 'merge',
      queryParams: { mode: null },
    });
  }
}
